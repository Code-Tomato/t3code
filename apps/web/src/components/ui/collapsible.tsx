"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";

import { cn } from "~/lib/utils";

// The root is a plain container; a variant gives it the chrome of the
// section it folds: a bordered card, or a rule on the edge it shares.
const collapsibleVariantClassName = {
  plain: "",
  card: "rounded-lg border border-border bg-background",
  "card-muted": "overflow-hidden rounded-lg border border-border/70 bg-muted/20",
  "divided-bottom": "border-b border-border/60",
  divided: "border-y border-border/60",
} as const;

function Collapsible({
  className,
  variant = "plain",
  ...props
}: CollapsiblePrimitive.Root.Props & { variant?: keyof typeof collapsibleVariantClassName }) {
  return (
    <CollapsiblePrimitive.Root
      className={cn(collapsibleVariantClassName[variant], className)}
      data-slot="collapsible"
      {...props}
    />
  );
}

function CollapsibleTrigger({ className, ...props }: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger
      className={cn("cursor-pointer", className)}
      data-slot="collapsible-trigger"
      {...props}
    />
  );
}

function CollapsiblePanel({ className, ...props }: CollapsiblePrimitive.Panel.Props) {
  // Reuses the local shadcn/Base UI panel; skip height travel for reduced motion.
  // https://ui.shadcn.com/docs/components/base/collapsible
  return (
    <CollapsiblePrimitive.Panel
      className={cn(
        "h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 motion-reduce:transition-none data-ending-style:h-0 data-starting-style:h-0 data-open:data-ending-style:[height:var(--collapsible-panel-height)]",
        className,
      )}
      data-slot="collapsible-panel"
      {...props}
    />
  );
}

export {
  Collapsible,
  CollapsibleTrigger,
  CollapsiblePanel,
  CollapsiblePanel as CollapsibleContent,
};
