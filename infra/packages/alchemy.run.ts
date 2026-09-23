import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

// pkg.t3.codes: the Worker in src/worker.ts in front of an R2 bucket that
// holds the signed apt and dnf index files. The release workflow uploads new
// indexes with packaging/linux/scripts/publish-repos.sh; see
// packaging/linux/README.md.
export const Bucket = Cloudflare.R2.Bucket("Indexes", { name: "t3code-packages" });

export const Worker = Cloudflare.Worker("Packages", {
  main: "./src/worker.ts",
  domain: "pkg.t3.codes",
  env: { Bucket },
});

export default Alchemy.Stack(
  "T3CodePackages",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const bucket = yield* Bucket;
    const worker = yield* Worker;
    return { bucketName: bucket.bucketName, url: worker.url.as<string>() };
  }),
);
