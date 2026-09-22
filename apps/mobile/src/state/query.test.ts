import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const atomReact = vi.hoisted(() => ({
  reads: [] as Array<{ readonly label?: readonly string[] }>,
  value: undefined as unknown,
  refresh: vi.fn(),
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: { readonly label?: readonly string[] }) => {
    atomReact.reads.push(atom);
    return atomReact.value;
  },
  useAtomRefresh: () => atomReact.refresh,
}));

import { formatEnvironmentQueryError, useEnvironmentQuery } from "./query";

describe("useEnvironmentQuery mobile bridge", () => {
  beforeEach(() => {
    atomReact.reads.length = 0;
    atomReact.value = undefined;
    atomReact.refresh = vi.fn();
  });

  it("reads through the platform-labeled empty atom when no query atom exists", () => {
    atomReact.value = AsyncResult.initial(false);

    const view = useEnvironmentQuery(null);

    expect(atomReact.reads[0]?.label?.[0]).toBe("mobile-environment-query:empty");
    expect(view.data).toBeNull();
    expect(view.error).toBeNull();
    expect(view.isPending).toBe(false);
    expect(view.isSuccess).toBe(false);
    expect(view.refresh).toBe(atomReact.refresh);
  });

  it("maps the selected atom's success value into the shared view", () => {
    atomReact.value = AsyncResult.success("payload");
    const atom = Atom.make(AsyncResult.success<string, Error>("payload"));

    const view = useEnvironmentQuery(atom);

    expect(atomReact.reads[0]?.label).toBeUndefined();
    expect(view.data).toBe("payload");
    expect(view.isSuccess).toBe(true);
    expect(view.dataUpdatedAt).toEqual(expect.any(Number));
    expect(view.isPending).toBe(false);
  });

  it("surfaces formatted failures and pending state through the bridge", () => {
    atomReact.value = AsyncResult.failure(Cause.fail(new Error("offline")));
    const failedAtom = Atom.make(
      AsyncResult.failure<string, Error>(Cause.fail(new Error("offline"))),
    );

    const view = useEnvironmentQuery(failedAtom);
    expect(view.error).toBe("offline");
    expect(view.isSuccess).toBe(false);
    expect(view.dataUpdatedAt).toBeNull();

    atomReact.value = AsyncResult.initial(true);
    const waitingAtom = Atom.make(AsyncResult.initial<string, Error>(true));
    expect(useEnvironmentQuery(waitingAtom).isPending).toBe(true);
  });

  it("re-exports the shared error formatter", () => {
    expect(formatEnvironmentQueryError(Cause.fail(new Error("boom")))).toBe("boom");
    expect(formatEnvironmentQueryError(Cause.fail("raw"))).toBe("The environment request failed.");
  });
});
