"use client";

import * as React from "react";
import { Dialog as D, Tooltip as T, Tabs as Tb, DropdownMenu as DM } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ───────────── Dialog (centred) ───────────── */

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = "max-w-lg",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-[rgb(10_16_32/0.45)] backdrop-blur-[2px] data-[state=open]:animate-[fade-up_200ms_var(--ease-out-expo)]" />
        <D.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-rule bg-card p-6 shadow-lift focus:outline-none",
            width,
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <D.Title className="text-xl font-bold text-ink">{title}</D.Title>
            <D.Close className="-mr-2 -mt-1 rounded-lg p-2 text-ink-3 hover:bg-paper-2 hover:text-ink" aria-label="Close">
              <X className="size-4" />
            </D.Close>
          </div>
          {description ? <D.Description className="mt-1.5 text-[0.95rem] text-ink-2">{description}</D.Description> : <D.Description className="sr-only">Dialog</D.Description>}
          {children ? <div className="mt-5">{children}</div> : null}
          {footer ? <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/* ───────────── Sheet (right drawer) ───────────── */

export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  label,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-[rgb(10_16_32/0.38)]" />
        <D.Content
          aria-label={label}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[44rem] flex-col border-l border-rule bg-paper shadow-lift focus:outline-none data-[state=open]:animate-[sheet-in_320ms_var(--ease-out-expo)]"
        >
          <div className="flex items-center justify-between gap-4 border-b border-rule bg-card px-6 py-4">
            <D.Title className="min-w-0 truncate text-base font-bold text-ink">{title}</D.Title>
            <D.Description className="sr-only">{label}</D.Description>
            <D.Close className="rounded-lg p-2 text-ink-3 hover:bg-paper-2 hover:text-ink" aria-label="Close panel">
              <X className="size-5" />
            </D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/* ───────────── Tooltip ───────────── */

export function Tip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <T.Root delayDuration={250}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="z-[60] max-w-xs rounded-lg bg-ink px-3 py-2 text-[0.82rem] leading-snug text-paper shadow-lift">
          {content}
          <T.Arrow className="fill-ink" />
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

/* ───────────── Tabs (standard, underlined) ───────────── */

export const Tabs = Tb.Root;
export const TabsContent = Tb.Content;

export function TabsList({ children, className, label }: { children: React.ReactNode; className?: string; label: string }) {
  return (
    <Tb.List aria-label={label} className={cn("flex gap-1 overflow-x-auto border-b border-rule", className)}>
      {children}
    </Tb.List>
  );
}

export function TabsTrigger({ value, children, count }: { value: string; children: React.ReactNode; count?: number }) {
  return (
    <Tb.Trigger
      value={value}
      className="relative -mb-px inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-[0.92rem] font-semibold text-ink-3 transition-colors hover:text-ink data-[state=active]:border-accent data-[state=active]:text-ink"
    >
      {children}
      {count !== undefined ? <span className="tabular rounded-full bg-paper-2 px-1.5 text-[0.75rem] text-ink-2">{count}</span> : null}
    </Tb.Trigger>
  );
}

/* ───────────── Dropdown menu ───────────── */

export const Menu = DM.Root;
export const MenuTrigger = DM.Trigger;

export function MenuContent({ children, align = "end" }: { children: React.ReactNode; align?: "start" | "end" | "center" }) {
  return (
    <DM.Portal>
      <DM.Content align={align} sideOffset={6} className="z-50 min-w-56 rounded-xl border border-rule bg-card p-1.5 shadow-lift">
        {children}
      </DM.Content>
    </DM.Portal>
  );
}

export function MenuItem({ children, onSelect, disabled, danger }: { children: React.ReactNode; onSelect?: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <DM.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.92rem] text-ink outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-paper-2",
        danger && "text-danger",
      )}
    >
      {children}
    </DM.Item>
  );
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <DM.Label className="px-2.5 pb-1 pt-2 text-[0.78rem] font-semibold text-ink-3">{children}</DM.Label>;
}

export const MenuSeparator = () => <DM.Separator className="my-1 h-px bg-rule" />;
