"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog as D } from "radix-ui";
import { House, Telescope, Stamp as StampIcon, Library, ScrollText, Activity, Settings, Compass, Moon, Sun, Menu as MenuIcon, X, Cpu, FileSearch, SquarePen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/ui/misc";
import { Tip } from "@/components/ui/overlay";
import { useTheme } from "@/components/providers";
import { useSession } from "@/lib/session";

const NAV = [
  { href: "/", label: "Home", icon: House, exact: true },
  { href: "/research", label: "Research", icon: Telescope },
  { href: "/audit", label: "Citation Audit", icon: StampIcon },
  { href: "/library", label: "Library", icon: Library },
  { href: "/draft", label: "Draft", icon: SquarePen },
  { href: "/receipts", label: "Honesty receipts", icon: ScrollText },
  { href: "/activity", label: "Activity log", icon: Activity },
  { href: "/settings", label: "Settings & policy", icon: Settings },
  { href: "/how-it-works", label: "How it works", icon: Compass },
] as const;

/** The AI mode, always visible at the top right of the work area (projector-friendly). */
function AiPill() {
  const { data } = useSession();
  if (!data) return <div className="h-9 w-56 rounded-full bg-paper-2" aria-hidden />;
  const ai = data.ai;
  const on = ai.mode === "ai";
  return (
    <Tip
      side="bottom"
      content={
        on
          ? `AI agents run on ${ai.active?.label} (${ai.active?.model}). Only short passages are sent; never your drafts or uploads.`
          : "No AI key is configured, so Knowlix runs in no-AI mode: summaries are exact quotes from sources, and every reference check still runs."
      }
    >
      <Link
        href="/settings#ai"
        className={cn(
          "inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[0.85rem] font-semibold transition-colors",
          on ? "border-[color-mix(in_oklab,var(--ok)_35%,var(--rule))] bg-ok-tint text-ok hover:brightness-95" : "border-[color-mix(in_oklab,var(--warn)_35%,var(--rule))] bg-warn-tint text-warn hover:brightness-95",
        )}
      >
        {on ? <Cpu className="size-4" aria-hidden /> : <FileSearch className="size-4" aria-hidden />}
        <span>{on ? "AI agents on" : "No-AI mode"}</span>
        <span className="hidden font-normal text-ink-2 sm:inline">· {on ? `${ai.active?.label}, ${ai.active?.model}` : "quotes only, checks still run"}</span>
      </Link>
    </Tip>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[0.82rem] font-semibold text-rail-muted transition-colors hover:bg-white/10 hover:text-rail-ink"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {dark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
      {dark ? "Light" : "Dark"}
    </button>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <React.Suspense fallback={<NavItems pathname={null} onNavigate={onNavigate} />}>
      <ActiveNav onNavigate={onNavigate} />
    </React.Suspense>
  );
}

function ActiveNav({ onNavigate }: { onNavigate?: () => void }) {
  return <NavItems pathname={usePathname()} onNavigate={onNavigate} />;
}

function NavItems({ pathname, onNavigate }: { pathname: string | null; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main">
      <ul className="space-y-0.5">
        {NAV.map((item) => {
          const active = pathname !== null && ("exact" in item && item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`));
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-3 px-3 py-2.5 text-[0.95rem] transition-colors",
                  // The open page is a tab cut from the page's own paper, joined to the work area at the rail's edge.
                  active ? "-mr-4 rounded-l-lg bg-paper pr-7 font-bold text-ink dark:bg-card-2" : "rounded-lg font-semibold text-rail-muted hover:bg-white/8 hover:text-rail-ink",
                )}
              >
                <Icon className={cn("size-[1.15rem] shrink-0", active ? "text-accent" : "")} aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function RailContents({ onNavigate }: { onNavigate?: () => void }) {
  const { data } = useSession();
  return (
    <div className="flex h-full flex-col gap-6 px-4 py-5">
      <Link href="/" onClick={onNavigate} className="flex items-center gap-2.5 px-1.5 text-rail-ink">
        <Logo className="size-9" />
        <span className="wide text-[1.28rem] font-extrabold tracking-[-0.02em]">Knowlix</span>
      </Link>
      <NavList onNavigate={onNavigate} />
      <div className="mt-auto">
        <div className="flex items-center justify-between px-1">
          <ThemeToggle />
          <Tip side="right" content="Your private workspace. No sign-in, no email. Settings → Workspace key moves it to another device.">
            <span className="font-record text-[0.78rem] tracking-wide text-rail-muted">WS·{data?.workspace.short.slice(0, 6) ?? "······"}</span>
          </Tip>
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="min-h-dvh lg:pl-[17rem] print:pl-0">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-card focus:px-4 focus:py-2 focus:shadow-lift">
        Skip to content
      </a>
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-[17rem] bg-rail lg:block">
        <RailContents />
      </aside>

      <header className="no-print sticky top-0 z-30 flex items-center justify-between bg-rail px-4 py-3 lg:hidden">
        <Link href="/" className="flex items-center gap-2 text-rail-ink">
          <Logo className="size-8" />
          <span className="wide text-lg font-extrabold">Knowlix</span>
        </Link>
        <D.Root open={open} onOpenChange={setOpen}>
          <D.Trigger className="rounded-lg p-2 text-rail-ink hover:bg-white/10" aria-label="Open menu">
            <MenuIcon className="size-6" />
          </D.Trigger>
          <D.Portal>
            <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
            <D.Content className="fixed inset-y-0 left-0 z-50 w-[17rem] bg-rail focus:outline-none" aria-label="Menu">
              <D.Title className="sr-only">Menu</D.Title>
              <D.Description className="sr-only">Main navigation</D.Description>
              <D.Close className="absolute right-3 top-4 rounded-lg p-2 text-rail-muted hover:text-rail-ink" aria-label="Close menu">
                <X className="size-5" />
              </D.Close>
              <RailContents onNavigate={() => setOpen(false)} />
            </D.Content>
          </D.Portal>
        </D.Root>
      </header>

      <main id="main" className="mx-auto w-full max-w-[84rem] px-4 pb-24 pt-4 sm:px-6 lg:px-10 lg:pt-5">
        <div className="no-print mb-4 flex justify-end">
          <AiPill />
        </div>
        {children}
      </main>
    </div>
  );
}

/**
 * The register rule that every page title sits on: a guilloche braid, as on the head of an
 * official record, ending in this workspace's serial.
 */
export function RegisterRule({ className }: { className?: string }) {
  const { data } = useSession();
  return (
    <div className={cn("register-rule", className)} aria-hidden>
      {/* The serial is only known in the browser, so the server's placeholder may differ. */}
      <span suppressHydrationWarning className="font-record text-[0.72rem] font-bold tracking-[0.12em] text-ink-3">
        KNOWLIX RECORD · WS-{data?.workspace.short.slice(0, 6) ?? "······"}
      </span>
    </div>
  );
}

export function PageHeader({ title, description, actions, children }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[1.85rem] font-extrabold leading-[1.1] text-ink sm:text-[2.2rem]">{title}</h1>
          {description ? <p className="mt-2 max-w-[46rem] text-[1.02rem] text-ink-2">{description}</p> : null}
        </div>
        {actions ? <div className="no-print flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <RegisterRule className="mt-4" />
      {children}
    </div>
  );
}
