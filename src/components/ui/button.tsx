import * as React from "react";
import { Slot } from "radix-ui";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "quiet-danger" | "link";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover disabled:bg-paper-2 disabled:text-ink-3 disabled:hover:bg-paper-2",
  secondary: "bg-card text-ink border border-rule-strong hover:bg-card-2 hover:border-ink-3 disabled:opacity-60",
  ghost: "text-ink-2 hover:bg-paper-2 hover:text-ink disabled:opacity-50",
  danger: "bg-danger text-white hover:brightness-110 disabled:bg-paper-2 disabled:text-ink-3 disabled:hover:brightness-100 dark:text-[#1a0806]",
  "quiet-danger": "text-danger border border-danger/40 bg-card hover:bg-danger-tint disabled:opacity-60",
  link: "text-accent underline underline-offset-4 hover:text-accent-hover px-0 h-auto",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[0.875rem] gap-1.5 rounded-md",
  md: "h-10 px-4 text-[0.95rem] gap-2 rounded-lg",
  lg: "h-12 px-5 text-base gap-2.5 rounded-lg",
  icon: "h-9 w-9 rounded-md justify-center",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, asChild = false, className, children, disabled, ...props },
  ref,
) {
  const classes = cn(
    "inline-flex items-center font-semibold whitespace-nowrap select-none transition-[background-color,border-color,color,filter,transform] duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:active:translate-y-0",
    variants[variant],
    variant !== "link" && sizes[size],
    className,
  );
  if (asChild) {
    return (
      <Slot.Root ref={ref} className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button ref={ref} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
});
