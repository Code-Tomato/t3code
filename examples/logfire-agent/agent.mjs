import * as NodeCrypto from "node:crypto";
import * as logfire from "@pydantic/logfire-node";

export const question =
  "What are the refund window and free trial length? Look up both policies and answer briefly.";
const policies = {
  refund: "Refunds are available within 30 days of purchase.",
  trial: "The free trial lasts 7 days.",
};
const topics = Object.keys(policies);
const topicSchema = { type: "string", enum: topics };

export function toolDefinition(variant) {
  if (!["single", "batch"].includes(variant)) throw new Error("Variant must be single or batch.");
  return {
    type: "function",
    name: variant === "single" ? "lookup_policy" : "lookup_policies",
    description: "Read the fictional demo store policies. This is local sample data.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties:
        variant === "single"
          ? { topic: topicSchema }
          : { topics: { type: "array", items: topicSchema, minItems: 1, maxItems: 2 } },
      required: [variant === "single" ? "topic" : "topics"],
    },
  };
}

export function executeLookup(call, variant) {
  const definition = toolDefinition(variant);
  if (call.name !== definition.name) throw new Error("Unknown demo tool.");
  let args;
  try {
    args = JSON.parse(call.arguments);
  } catch {
    throw new Error("Invalid tool arguments.");
  }
  const key = variant === "single" ? "topic" : "topics";
  if (!args || typeof args !== "object" || Object.keys(args).length !== 1 || !(key in args))
    throw new Error("Invalid tool arguments.");
  const requested = variant === "single" ? [args.topic] : args.topics;
  if (
    !Array.isArray(requested) ||
    requested.length < 1 ||
    requested.length > 2 ||
    requested.some((t) => typeof t !== "string" || !Object.hasOwn(policies, t))
  )
    throw new Error("Unknown policy topic.");
  return Object.fromEntries(requested.map((t) => [t, policies[t]]));
}

function messagesForTrace(messages) {
  return messages.flatMap((m) => {
    if (m.type === "function_call")
      return [
        {
          role: "assistant",
          parts: [{ type: "tool_call", id: m.call_id, name: m.name, arguments: m.arguments }],
        },
      ];
    if (m.type === "function_call_output")
      return [
        {
          role: "tool",
          parts: [{ type: "tool_call_response", id: m.call_id, response: m.output }],
        },
      ];
    if (!m.role || m.role === "system") return [];
    const text =
      typeof m.content === "string"
        ? m.content
        : (m.content ?? [])
            .filter((p) => p.type === "output_text" || p.type === "input_text")
            .map((p) => p.text)
            .join("\n");
    return [{ role: m.role, parts: [{ type: "text", content: text }] }];
  });
}

// Record a generic error, never an HTTP body that might echo a credential.
async function traced(name, attributes, callback) {
  return logfire.span(name, {
    attributes,
    ...(attributes["gen_ai.operation.name"] === "chat" ? { kind: 2 } : {}),
    callback: async (span) => {
      try {
        return await callback(span);
      } catch (error) {
        span.setAttribute("error.type", error.name);
        span.setStatus({ code: 2, message: error.message });
        throw error;
      }
    },
  });
}

export async function runAgent({
  variant,
  model,
  apiKey,
  baseUrl = "https://api.openai.com/v1",
  comparisonId = NodeCrypto.randomUUID(),
  captureContent = false,
  timeoutMs = 60000,
}) {
  const tool = toolDefinition(variant);
  const endpoint = new URL(`${baseUrl.replace(/\/$/, "")}/responses`);
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error("Invalid model API URL.");
  const instructions =
    "You answer questions about a fictional demo store. Use the provided policy tool to check every requested policy before answering. Do not invent policies.";
  const messages = [{ role: "user", content: question }];
  const name = `policy-helper-${variant}`;
  const started = performance.now();
  const summary = {
    variant,
    model,
    comparisonId,
    modelCalls: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    usageComplete: true,
  };
  const readTopics = new Set();
  return traced(
    `invoke_agent ${name}`,
    {
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.agent.name": name,
      "gen_ai.agent.version": "1",
      "gen_ai.provider.name": "openai",
      "gen_ai.request.model": model,
      "gen_ai.conversation.id": NodeCrypto.randomUUID(),
      "demo.comparison_id": comparisonId,
      "demo.variant": variant,
      "gen_ai.tool.definitions": [tool],
      ...(captureContent
        ? {
            "gen_ai.input.messages": messagesForTrace(messages),
            "gen_ai.system_instructions": [{ type: "text", content: instructions }],
          }
        : {}),
    },
    async (root) => {
      summary.traceId = root.spanContext().traceId;
      for (let step = 0; step < 6; step++) {
        const response = await traced(
          `chat ${model}`,
          {
            "gen_ai.operation.name": "chat",
            "gen_ai.provider.name": "openai",
            "gen_ai.request.model": model,
            "server.address": endpoint.hostname,
            ...(captureContent ? { "gen_ai.input.messages": messagesForTrace(messages) } : {}),
          },
          async (span) => {
            summary.modelCalls++;
            let http;
            try {
              http = await fetch(endpoint, {
                method: "POST",
                headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  model,
                  instructions,
                  input: messages,
                  tools: [tool],
                  tool_choice: "auto",
                  parallel_tool_calls: false,
                  store: false,
                  include: ["reasoning.encrypted_content"],
                }),
                signal: AbortSignal.timeout(timeoutMs),
              });
            } catch {
              throw new Error("Model request failed or timed out.");
            }
            if (!http.ok) {
              await http.body?.cancel();
              throw new Error(`Model request failed with HTTP ${http.status}.`);
            }
            let data;
            try {
              data = await http.json();
            } catch {
              throw new Error("Invalid model JSON response.");
            }
            if (data.status !== "completed" || !Array.isArray(data.output))
              throw new Error("Model response did not complete.");
            span.setAttribute("gen_ai.response.model", data.model ?? model);
            if (typeof data.id === "string") span.setAttribute("gen_ai.response.id", data.id);
            span.setAttribute("gen_ai.response.finish_reasons", [
              data.output.some((item) => item.type === "function_call") ? "tool_calls" : "stop",
            ]);
            for (const [source, target, counter] of [
              ["input_tokens", "input_tokens", "inputTokens"],
              ["output_tokens", "output_tokens", "outputTokens"],
            ]) {
              const count = data.usage?.[source];
              if (Number.isSafeInteger(count) && count >= 0) {
                span.setAttribute(`gen_ai.usage.${target}`, count);
                summary[counter] += count;
              } else summary.usageComplete = false;
            }
            const cached = data.usage?.input_tokens_details?.cached_tokens;
            if (Number.isSafeInteger(cached) && cached >= 0)
              span.setAttribute("gen_ai.usage.cache_read.input_tokens", cached);
            if (captureContent)
              span.setAttribute(
                "gen_ai.output.messages",
                JSON.stringify(messagesForTrace(data.output)),
              );
            return data;
          },
        );
        messages.push(...response.output);
        const calls = response.output.filter((item) => item.type === "function_call");
        if (!calls.length) {
          const answer = response.output
            .filter((item) => item.type === "message")
            .flatMap((item) => item.content ?? [])
            .filter((part) => part.type === "output_text")
            .map((part) => part.text)
            .join("\n");
          if (!answer.trim()) throw new Error("Model did not finish with an answer.");
          summary.answer = answer;
          summary.lookedUpBothPolicies = topics.every((t) => readTopics.has(t));
          if (!summary.usageComplete) {
            summary.inputTokens = null;
            summary.outputTokens = null;
          }
          summary.durationMs = Math.round(performance.now() - started);
          root.setAttributes({
            "demo.model_calls": summary.modelCalls,
            "demo.tool_calls": summary.toolCalls,
            "demo.looked_up_both_policies": summary.lookedUpBothPolicies,
          });
          // Usage belongs on model spans; duplicating it here would double count totals.
          if (captureContent)
            root.setAttribute(
              "gen_ai.output.messages",
              JSON.stringify(messagesForTrace(response.output)),
            );
          return summary;
        }
        if (calls.length > 2) throw new Error("Too many tool calls in one response.");
        for (const call of calls) {
          if (typeof call.name !== "string" || typeof call.call_id !== "string")
            throw new Error("Invalid tool call.");
          const result = await traced(
            `execute_tool ${tool.name}`,
            {
              "gen_ai.operation.name": "execute_tool",
              "gen_ai.tool.name": tool.name,
              "gen_ai.tool.type": "function",
              "gen_ai.tool.call.id": call.call_id,
            },
            async (span) => {
              const value = executeLookup(call, variant);
              summary.toolCalls++;
              Object.keys(value).forEach((t) => readTopics.add(t));
              if (captureContent)
                span.setAttributes({
                  "gen_ai.tool.call.arguments": call.arguments,
                  "gen_ai.tool.call.result": JSON.stringify(value),
                });
              return value;
            },
          );
          messages.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(result),
          });
        }
      }
      throw new Error("Agent exceeded the six model-call limit.");
    },
  );
}
