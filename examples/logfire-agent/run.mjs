import * as NodeCrypto from "node:crypto";
import * as logfire from "@pydantic/logfire-node";
import { runAgent } from "./agent.mjs";

const { LOGFIRE_TOKEN, OPENAI_API_KEY, DEMO_MODEL, OPENAI_BASE_URL, LOGFIRE_PROJECT_URL } =
  process.env;
if (!LOGFIRE_TOKEN || !OPENAI_API_KEY || !DEMO_MODEL) {
  console.error("Set LOGFIRE_TOKEN, OPENAI_API_KEY, and DEMO_MODEL in .env. See README.md.");
  process.exit(1);
}
let project;
if (LOGFIRE_PROJECT_URL) {
  project = new URL(LOGFIRE_PROJECT_URL);
  if (
    project.protocol !== "https:" ||
    !["logfire.pydantic.dev", "logfire-us.pydantic.dev", "logfire-eu.pydantic.dev"].includes(
      project.hostname,
    ) ||
    project.username ||
    project.password ||
    project.search ||
    project.hash
  )
    throw new Error("Use your Logfire project URL without query parameters.");
}
logfire.configure({ serviceName: "t3-agent-demo", sendToLogfire: true, console: false });
const comparisonId = NodeCrypto.randomUUID();
console.log(
  `Comparison ${comparisonId}. Same question and model, single-policy versus batched lookup.`,
);
console.log(
  "Only synthetic store policies are used. Content capture:",
  process.env.DEMO_CAPTURE_CONTENT === "true",
);
try {
  for (const variant of ["single", "batch"]) {
    const result = await runAgent({
      variant,
      model: DEMO_MODEL,
      apiKey: OPENAI_API_KEY,
      ...(OPENAI_BASE_URL ? { baseUrl: OPENAI_BASE_URL } : {}),
      comparisonId,
      captureContent: process.env.DEMO_CAPTURE_CONTENT === "true",
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.lookedUpBothPolicies) {
      console.error(
        "This run skipped a required policy lookup; inspect it before claiming a successful comparison.",
      );
      process.exitCode = 1;
    }
    if (project) {
      const trace = new URL(project);
      trace.searchParams.set("q", `trace_id='${result.traceId}'`);
      trace.searchParams.set("since", new Date(Date.now() - 3600000).toISOString());
      console.log("Trace:", trace.href);
    }
  }
  if (project)
    console.log(
      "Dashboard:",
      project.href,
      "\nOpen Agents → policy-helper-single / policy-helper-batch → Runs.",
    );
  console.log(
    "Compare measured results; one pair is not a benchmark. Missing usage is not zero usage. Costs are estimated by Logfire only for recognized models.",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await logfire.shutdown();
}
