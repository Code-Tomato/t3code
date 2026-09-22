import { assert, describe, it } from "@effect/vitest";
import { twMerge } from "tailwind-merge";

import { buttonVariants } from "./button";

const colorUtilities = (className: string) =>
  twMerge(className)
    .split(" ")
    .filter((utility) => /^(\[:hover,\[data-pressed\]\]:)?text-(?!\[|base|sm|xs|lg)/.test(utility));

describe("buttonVariants", () => {
  // cva emits variants in declaration order and cn() resolves conflicts by
  // keeping the last utility, so a tone must be declared after variant to
  // recolor a ghost or outline button.
  it("lets a tone override the variant's text color", () => {
    assert.deepStrictEqual(colorUtilities(buttonVariants({ variant: "ghost", tone: "warning" })), [
      "text-warning",
      "[:hover,[data-pressed]]:text-warning",
    ]);
    assert.deepStrictEqual(
      colorUtilities(buttonVariants({ variant: "ghost-muted", tone: "destructive" })),
      ["text-muted-foreground", "[:hover,[data-pressed]]:text-destructive"],
    );
  });
});
