import type * as React from "react";

import { cn } from "~/lib/utils";

const kbdSizeClassName = {
  xs: "h-4 min-w-0 rounded-sm px-1.5 text-[10px]",
  default: "h-5 min-w-5 rounded px-1 text-xs",
  wide: "h-5 min-w-6 rounded px-1.5 text-xs",
} as const;

function Kbd({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"kbd"> & { size?: keyof typeof kbdSizeClassName }) {
  return (
    <kbd
      className={cn(
        "pointer-events-none inline-flex select-none items-center justify-center gap-1 bg-muted font-medium font-sans text-muted-foreground [&_svg:not([class*='size-'])]:size-3",
        kbdSizeClassName[size],
        className,
      )}
      data-slot="kbd"
      {...props}
    />
  );
}

function KbdGroup({
  className,
  gap = "default",
  ...props
}: React.ComponentProps<"kbd"> & { gap?: "default" | "loose" }) {
  return (
    <kbd
      className={cn("inline-flex items-center", gap === "loose" ? "gap-1.5" : "gap-1", className)}
      data-slot="kbd-group"
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
