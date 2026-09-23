import { describe, expect, it } from "vite-plus/test";

import { releaseAssetUrl } from "./worker.ts";

describe("releaseAssetUrl", () => {
  it("redirects apt and dnf pool paths to the release asset", () => {
    expect(releaseAssetUrl("/apt/pool/v0.0.42/t3code_0.0.42_amd64.deb")).toBe(
      "https://github.com/pingdotgg/t3code/releases/download/v0.0.42/t3code_0.0.42_amd64.deb",
    );
    expect(
      releaseAssetUrl(
        "/rpm/nightly/aarch64/pool/v0.0.43-nightly.20260922.2110/t3code-nightly_0.0.43-nightly.20260922.2110_aarch64.rpm",
      ),
    ).toBe(
      "https://github.com/pingdotgg/t3code/releases/download/v0.0.43-nightly.20260922.2110/t3code-nightly_0.0.43-nightly.20260922.2110_aarch64.rpm",
    );
  });

  it("leaves index files and anything that is not a package to the bucket", () => {
    expect(releaseAssetUrl("/apt/dists/stable/InRelease")).toBeNull();
    expect(releaseAssetUrl("/rpm/stable/x86_64/repodata/repomd.xml")).toBeNull();
    expect(releaseAssetUrl("/apt/pool/v0.0.42/../../secrets.deb")).toBeNull();
    expect(releaseAssetUrl("/apt/pool/v0.0.42/notes.txt")).toBeNull();
    expect(releaseAssetUrl("/apt/pool/latest/t3code_0.0.42_amd64.deb")).toBeNull();
  });
});
