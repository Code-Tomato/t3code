import { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentPresentation } from "../connection/presentation.ts";
import { createEnvironmentPresentationAtomSelector } from "./presentation.ts";

describe("createEnvironmentPresentationAtomSelector", () => {
  const consulted: EnvironmentId[] = [];
  const selector = createEnvironmentPresentationAtomSelector({
    presentationAtom: (environmentId) => {
      consulted.push(environmentId);
      return Atom.make<EnvironmentPresentation | null>(null).pipe(
        Atom.withLabel(`presentation:${environmentId}`),
      );
    },
    platform: "web",
  });

  it("serves the platform-labeled empty atom without consulting the family", () => {
    expect(selector(null).label?.[0]).toBe("web-environment-presentation:empty");
    expect(consulted).toEqual([]);
  });

  it("delegates to the family atom once an environment is selected", () => {
    const environmentId = EnvironmentId.make("environment-a");

    expect(selector(environmentId).label?.[0]).toBe("presentation:environment-a");
    expect(consulted).toEqual([environmentId]);
  });
});
