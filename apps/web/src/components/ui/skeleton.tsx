import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

// A skeleton's width and height are its content, so consumers size it through
// className (the lint contract allows layout there). Its shape and tint are not.
const skeletonVariants = cva("bg-muted-foreground/15 motion-safe:animate-skeleton", {
  variants: {
    shape: {
      block: "rounded-sm",
      rounded: "rounded-md",
      card: "rounded-lg",
      pill: "rounded-full",
    },
    tone: {
      default: "",
      subtle: "bg-muted-foreground/10",
    },
  },
  defaultVariants: { shape: "block", tone: "default" },
});

function Skeleton({
  className,
  shape,
  tone,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof skeletonVariants>) {
  return (
    <div
      className={cn(skeletonVariants({ shape, tone }), className)}
      data-slot="skeleton"
      {...props}
    />
  );
}

export { Skeleton };
