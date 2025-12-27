import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 touch-manipulation",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-md hover:shadow-lg hover:bg-primary/90 active:scale-[0.97]",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:shadow-[0_0_20px_4px_hsl(var(--destructive)/0.4)] active:scale-[0.97]",
        outline:
          "border border-border bg-transparent text-foreground hover:bg-muted/50 hover:border-primary/60 hover:text-primary active:scale-[0.97]",
        secondary:
          "bg-secondary text-secondary-foreground border border-border/50 hover:bg-secondary/80 hover:border-primary/40 active:scale-[0.97]",
        ghost:
          "text-muted-foreground hover:bg-muted hover:text-foreground active:scale-[0.97]",
        link: 
          "text-primary underline-offset-4 hover:underline hover:text-primary/80",
        gold:
          "bg-primary text-primary-foreground shadow-md hover:shadow-lg hover:brightness-110 active:scale-[0.97] active:brightness-100",
      },
      size: {
        default: "h-10 px-5 py-2 min-w-[44px]",
        sm: "h-9 rounded-md px-4 text-xs min-w-[36px]",
        lg: "h-12 rounded-md px-8 text-base min-w-[48px]",
        icon: "h-10 w-10 min-w-[44px] min-h-[44px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };