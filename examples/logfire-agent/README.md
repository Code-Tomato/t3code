# JavaScript agent demo for Logfire

A small policy assistant runs the same question twice: first with a tool that reads
one policy, then with a tool that can read both. Open the runs in Logfire to compare
model calls, tool calls, tokens, duration, and answers. This is a standalone sample
inside draft PR #12014, not instrumentation of t3.chat or T3's provider sessions.
The earlier T3 checkpoint demo remains available separately.

## Run locally

Use Node 24.13.1 or later. No T3 server or real T3 database is needed.

```sh
cd examples/logfire-agent
npm ci
cp .env.example .env
# Fill in your credentials, model, and Logfire project URL privately.
npm start
```

Use your own Logfire project's write token and a model API credential. Choose a
model that supports Responses API function calls. `OPENAI_BASE_URL` is optional
for authorized Responses-compatible providers. A Codex subscription login alone
is not necessarily a model API credential. Requests use `store: false`.

The sample exports synthetic store policies only. `DEMO_CAPTURE_CONTENT=true`
adds messages and tool inputs/outputs to traces; it is opt-in in code. Do not use
real conversations for a recording. No credential should appear on screen.

The command prints the answer, actual usage, counts, duration, trace ID, and a
trace link under **your** configured `LOGFIRE_PROJECT_URL`. It exits nonzero on
provider/tool errors, unfinished responses, or skipped policy lookups. Missing
provider usage is labeled `usageComplete: false`, not assumed to be free.

## Inside Logfire

Open your project, select the current time range, and open **Agents** in the
sidebar. Look for `policy-helper-single` and `policy-helper-batch`, then open
**Runs**. Use **Tools**, **Messages**, and **Trace** to inspect what happened.
The sample emits `gen_ai.operation.name=invoke_agent` root spans, nested `chat`
and `execute_tool` spans, and provider-reported token counts on model spans only.
These follow Logfire's documented agent discovery convention. Costs depend on
Logfire recognizing the returned model and its pricing; no costs are fabricated.

If the Agents view is unavailable, use **Live** with `service_name = 't3-agent-demo'`
or the trace links printed by the command. In **Explore**, inspect agent runs:

```sql
SELECT start_timestamp, trace_id, duration,
  attributes->>'gen_ai.agent.name' AS agent,
  attributes->>'demo.comparison_id' AS comparison,
  attributes->>'demo.tool_calls' AS tool_calls
FROM records
WHERE service_name = 't3-agent-demo'
  AND attributes->>'gen_ai.operation.name' = 'invoke_agent'
  AND start_timestamp > now() - interval '1 hour'
ORDER BY start_timestamp DESC LIMIT 20
```

Compare runs sharing `demo.comparison_id`. A model can choose multiple tool calls
in one response, so fewer tool calls need not mean fewer model calls. One pair is
not a benchmark, and lookup coverage is not an answer-quality evaluation. Read
both answers against the two source policies before claiming quality improved.

## What to show

1. Show `agent.mjs`: the model request, the two tool definitions, and the agent span.
2. Run `npm start`, then switch to your Logfire project rather than its marketing website.
3. Open both runs. Show actual calls and usage, the tool arguments/results, and answers.
4. Explain the observed tradeoff. Do not promise lower latency or cost from a single run.

Do not say t3.chat was instrumented, that setup took two minutes, or that checks
are green unless those facts have actually been verified for the recording.
Keep #12014 a draft demo forever. Never merge or close it.

## Tests and current evidence

`npm test` uses a local HTTP model fixture and real in-memory telemetry to check
request continuation, parent/child spans, token accounting, content opt-in,
missing usage, failures, malformed tools, and the model-call limit. The dedicated
GitHub Actions workflow runs these tests without provider or Logfire credentials.

A live Responses-compatible provider run on September 23 returned correct
30-day refund and 7-day trial answers in both configurations. Logfire MCP confirmed
both agent roots, model/tool children, messages, and usage:

| Configuration    | Model calls | Tool calls | Input / output tokens | Duration |
| ---------------- | ----------- | ---------- | --------------------- | -------- |
| Single policy    | 2           | 2          | 895 / 73              | 7.14 s   |
| Batched policies | 2           | 1          | 893 / 46              | 9.68 s   |

That pair reduced tool calls and output tokens, **not latency**. Agent discovery
attributes and ingestion were verified against Logfire's documented conventions;
the authenticated Agents page and its cost rendering have not been visually
verified. The API-key MCP connection cannot bootstrap a dashboard login. Check
that page in your own signed-in browser before recording.

References: [Logfire Agents](https://logfire.pydantic.dev/docs/guides/web-ui/agents/),
[JavaScript SDK](https://github.com/pydantic/logfire-js),
[OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling).
