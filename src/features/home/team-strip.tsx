import Link from "next/link";
import { Compass, Eye, FileOutput, Gavel, Hand, PenLine, Search, ShieldCheck, SquarePen } from "lucide-react";
import { cn } from "@/lib/utils";

type Kind = "ai" | "code";

const PHASES: { name: string; workers: { kind: Kind; label: string; note: string; Icon: typeof Compass }[]; gate: string }[] = [
  { name: "Plan", workers: [{ kind: "ai", label: "Planner", note: "drafts the searches", Icon: Compass }], gate: "You approve the plan" },
  {
    name: "Sources",
    workers: [
      { kind: "ai", label: "Finder", note: "searches and screens", Icon: Search },
      { kind: "code", label: "Verifier", note: "proves each source is real", Icon: ShieldCheck },
    ],
    gate: "You choose the sources",
  },
  {
    name: "Summary",
    workers: [
      { kind: "ai", label: "Writer", note: "cites passages only", Icon: PenLine },
      { kind: "code", label: "Checker", note: "quotes, numbers, names", Icon: ShieldCheck },
      { kind: "ai", label: "Judge", note: "four fixed answers", Icon: Gavel },
      { kind: "ai", label: "Critic", note: "flags bias and gaps", Icon: Eye },
    ],
    gate: "You review every label",
  },
  {
    name: "Finish",
    workers: [
      { kind: "code", label: "Export", note: "references and a receipt", Icon: FileOutput },
      { kind: "code", label: "Draft", note: "you write, Knowlix cites", Icon: SquarePen },
    ],
    gate: "Your work, your name on it",
  },
];

const TONE: Record<Kind, string> = {
  ai: "bg-neutral-tint text-neutral",
  code: "bg-paper-2 text-ink-2",
};

/** The whole workflow at a glance: who does what, and the three places where the student decides. */
export function TeamStrip() {
  return (
    <section className="rounded-2xl border border-rule bg-card p-5 shadow-card" aria-labelledby="team-h">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="team-h" className="text-[1.05rem] font-bold text-ink">
          A team with narrow jobs, and you at every gate
        </h2>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8rem] font-semibold">
          <span className="inline-flex items-center gap-1.5 text-neutral">
            <span className="size-2.5 rounded-full bg-neutral" aria-hidden /> AI: can only suggest
          </span>
          <span className="inline-flex items-center gap-1.5 text-ink-2">
            <span className="size-2.5 rounded-full bg-ink-3" aria-hidden /> Code: decides what is real
          </span>
          <span className="inline-flex items-center gap-1.5 text-accent">
            <span className="size-2.5 rounded-full bg-accent" aria-hidden /> You: decide what is used
          </span>
        </p>
      </div>
      <ol className="mt-4 grid gap-3 sm:grid-cols-2">
        {PHASES.map((p, i) => (
          <li key={p.name} className="flex flex-col rounded-xl border border-rule bg-card-2 p-3">
            <p className="flex items-center gap-2 text-[0.88rem] font-extrabold text-ink">
              <span className="grid size-5 place-items-center rounded-full bg-ink text-[0.72rem] text-card tabular">{i + 1}</span>
              {p.name}
            </p>
            <ul className="mt-2 flex flex-1 flex-wrap content-start gap-1.5">
              {p.workers.map((w) => (
                <li key={w.label} className={cn("rounded-lg px-2.5 py-1.5", TONE[w.kind])}>
                  <span className="flex items-center gap-1.5 text-[0.86rem] font-extrabold leading-tight">
                    <w.Icon className="size-4 shrink-0" aria-hidden />
                    {w.label}
                  </span>
                  <span className="block text-[0.75rem] font-semibold leading-tight text-ink-2">{w.note}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-accent-tint px-2.5 py-1.5 text-[0.84rem] font-bold text-accent">
              <Hand className="size-4 shrink-0" aria-hidden />
              {p.gate}
            </p>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[0.88rem] text-ink-2">
        No AI can save a reference or pass a gate. Ask a question and watch each of them work live in the agent room.{" "}
        <Link href="/how-it-works" className="font-semibold text-accent hover:text-accent-hover">
          Read each agent&rsquo;s rules
        </Link>
      </p>
    </section>
  );
}
