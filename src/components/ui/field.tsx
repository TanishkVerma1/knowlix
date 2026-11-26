import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-lg border border-rule-strong bg-card px-3 text-[0.95rem] text-ink placeholder:text-ink-3 transition-colors hover:border-ink-3 focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent/30 disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-lg border border-rule-strong bg-card px-3 py-2.5 text-[0.95rem] text-ink placeholder:text-ink-3 transition-colors hover:border-ink-3 focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent/30",
        className,
      )}
      {...props}
    />
  );
});

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[0.875rem] font-semibold text-ink-2", className)} {...props} />;
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 rounded-lg border border-rule-strong bg-card px-3 pr-8 text-[0.95rem] text-ink transition-colors hover:border-ink-3 focus-visible:border-accent",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded-md border border-rule-strong bg-card-2 px-1.5 py-0.5 font-mono text-[0.75rem] text-ink-2">{children}</kbd>;
}
