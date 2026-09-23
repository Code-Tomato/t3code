import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import * as NodeHttp from "node:http";
import * as logfire from "@pydantic/logfire-node";
import { runAgent, executeLookup } from "./agent.mjs";

const spans = [];
logfire.configure({
  sendToLogfire: false,
  console: false,
  metrics: false,
  additionalSpanProcessors: [
    {
      onStart() {},
      onEnd(span) {
        spans.push(span);
      },
      async forceFlush() {},
      async shutdown() {},
    },
  ],
});
NodeTest.after(() => logfire.shutdown());

async function withModel(handler, callback) {
  const requests = [];
  const server = NodeHttp.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    const result = handler(requests.at(-1), requests.length);
    res.writeHead(result.status ?? 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result.body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await callback(`http://127.0.0.1:${server.address().port}/v1`, requests);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
const toolCall = (name, args, id = "call_1") => ({
  type: "function_call",
  call_id: id,
  name,
  arguments: JSON.stringify(args),
});
const answer = {
  type: "message",
  role: "assistant",
  content: [{ type: "output_text", text: "Refunds: 30 days. Trial: 7 days." }],
};
const response = (output, usage = { input_tokens: 100, output_tokens: 20 }) => ({
  body: {
    status: "completed",
    id: "response_test",
    model: "test-model",
    output,
    ...(usage ? { usage } : {}),
  },
});
const options = { model: "test-model", apiKey: "private-test-key", captureContent: true };

for (const variant of ["single", "batch"])
  NodeTest.test(
    `${variant}: real HTTP tool loop, child spans, usage, and policy coverage`,
    async () => {
      const start = spans.length;
      await withModel(
        (_req, n) => {
          if (variant === "batch")
            return response(
              n === 1 ? [toolCall("lookup_policies", { topics: ["refund", "trial"] })] : [answer],
            );
          return response(
            n === 1
              ? [toolCall("lookup_policy", { topic: "refund" })]
              : n === 2
                ? [toolCall("lookup_policy", { topic: "trial" }, "call_2")]
                : [answer],
          );
        },
        async (baseUrl, requests) => {
          const result = await runAgent({ ...options, variant, baseUrl });
          NodeAssert.equal(result.lookedUpBothPolicies, true);
          NodeAssert.equal(result.toolCalls, variant === "single" ? 2 : 1);
          NodeAssert.equal(result.modelCalls, variant === "single" ? 3 : 2);
          NodeAssert.equal(result.inputTokens, result.modelCalls * 100);
          NodeAssert.equal(result.outputTokens, result.modelCalls * 20);
          NodeAssert.equal(result.usageComplete, true);
          NodeAssert.equal(requests[0].store, false);
          NodeAssert.ok(
            requests
              .at(-1)
              .input.some((i) => i.type === "function_call_output" && i.output.includes("30 days")),
          );
          const recorded = spans
            .slice(start)
            .filter((s) => s.attributes["logfire.span_type"] !== "pending_span");
          const root = recorded.find(
            (s) => s.attributes["gen_ai.operation.name"] === "invoke_agent",
          );
          NodeAssert.ok(root);
          NodeAssert.equal(root.spanContext().traceId, result.traceId);
          const children = recorded.filter((s) =>
            ["chat", "execute_tool"].includes(s.attributes["gen_ai.operation.name"]),
          );
          NodeAssert.equal(children.length, result.modelCalls + result.toolCalls);
          for (const child of children)
            NodeAssert.equal(child.parentSpanContext.spanId, root.spanContext().spanId);
          NodeAssert.equal(root.attributes["gen_ai.usage.input_tokens"], undefined);
          NodeAssert.ok(root.attributes["gen_ai.output.messages"].includes("30 days"));
          NodeAssert.ok(
            !JSON.stringify(recorded.map((s) => s.attributes)).includes(options.apiKey),
          );
        },
      );
    },
  );

NodeTest.test("content is opt-in and missing provider usage is explicitly incomplete", async () => {
  const start = spans.length;
  await withModel(
    () => response([answer], null),
    async (baseUrl) => {
      const result = await runAgent({
        ...options,
        variant: "batch",
        baseUrl,
        captureContent: false,
      });
      NodeAssert.equal(result.usageComplete, false);
      NodeAssert.equal(result.inputTokens, null);
      NodeAssert.equal(result.outputTokens, null);
      NodeAssert.equal(result.lookedUpBothPolicies, false);
      for (const s of spans.slice(start)) {
        NodeAssert.equal(s.attributes["gen_ai.input.messages"], undefined);
        NodeAssert.equal(s.attributes["gen_ai.output.messages"], undefined);
        NodeAssert.equal(s.attributes["gen_ai.usage.input_tokens"], undefined);
      }
    },
  );
});

NodeTest.test(
  "HTTP failure marks agent/model errors without exporting response body or key",
  async () => {
    const start = spans.length;
    await withModel(
      () => ({ status: 401, body: { error: "private-test-key" } }),
      async (baseUrl) => {
        await NodeAssert.rejects(runAgent({ ...options, variant: "single", baseUrl }), /HTTP 401/);
        const failed = spans.slice(start).filter((s) => s.status.code === 2);
        NodeAssert.ok(failed.some((s) => s.attributes["gen_ai.operation.name"] === "invoke_agent"));
        NodeAssert.ok(failed.some((s) => s.attributes["gen_ai.operation.name"] === "chat"));
        NodeAssert.ok(
          !JSON.stringify(
            failed.map((s) => ({ attributes: s.attributes, events: s.events, status: s.status })),
          ).includes(options.apiKey),
        );
      },
    );
  },
);

NodeTest.test("runaway tool loop stops after six model calls", async () => {
  await withModel(
    () => response([toolCall("lookup_policy", { topic: "refund" })]),
    async (baseUrl, requests) => {
      await NodeAssert.rejects(
        runAgent({ ...options, variant: "single", baseUrl }),
        /six model-call limit/,
      );
      NodeAssert.equal(requests.length, 6);
    },
  );
});

NodeTest.test("incomplete responses do not become successful runs", async () => {
  await withModel(
    () => ({ body: { status: "incomplete", output: [answer] } }),
    async (baseUrl) => {
      await NodeAssert.rejects(
        runAgent({ ...options, variant: "single", baseUrl }),
        /did not complete/,
      );
    },
  );
});

NodeTest.test(
  "tools reject unrecognized names, malformed arguments, and inherited property names",
  () => {
    for (const call of [
      toolCall("shell", {}),
      { name: "lookup_policy", arguments: "{" },
      toolCall("lookup_policy", { topic: "__proto__" }),
      toolCall("lookup_policy", { topic: "refund", extra: true }),
    ]) {
      NodeAssert.throws(() => executeLookup(call, "single"));
    }
    NodeAssert.throws(() => executeLookup(toolCall("lookup_policies", { topics: [] }), "batch"));
  },
);

NodeTest.test(
  "stateless continuation preserves reasoning items without exporting them",
  async () => {
    const start = spans.length;
    const reasoning = {
      type: "reasoning",
      id: "reasoning_id",
      summary: [],
      encrypted_content: "private-reasoning-test",
    };
    await withModel(
      (_request, n) =>
        response(
          n === 1
            ? [reasoning, toolCall("lookup_policies", { topics: ["refund", "trial"] })]
            : [answer],
        ),
      async (baseUrl, requests) => {
        await runAgent({ ...options, variant: "batch", baseUrl });
        NodeAssert.deepEqual(requests[0].include, ["reasoning.encrypted_content"]);
        NodeAssert.deepEqual(
          requests[1].input.find((item) => item.type === "reasoning"),
          reasoning,
        );
        NodeAssert.ok(
          !JSON.stringify(spans.slice(start).map((s) => s.attributes)).includes(
            "private-reasoning-test",
          ),
        );
      },
    );
  },
);
