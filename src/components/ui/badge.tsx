import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: 
          "border-primary/30 bg-primary/20 text-primary hover:bg-primary/30",
        secondary: 
          "border-border bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: 
          "border-destructive/30 bg-destructive/20 text-destructive hover:bg-destructive/30",
        outline: 
          "border-border text-foreground hover:bg-muted",
        gold:
          "border-primary/40 bg-gradient-to-r from-primary/20 to-primary/10 text-primary shadow-inner-gold",
        success:
          "border-emerald-500/30 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30",
        warning:
          "border-amber-500/30 bg-amber-500/20 text-amber-400 hover:bg-amber-500/30",
        info:
          "border-blue-500/30 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };