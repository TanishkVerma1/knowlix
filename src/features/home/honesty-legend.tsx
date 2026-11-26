import Link from "next/link";
import { ShieldCheck, Gavel, ArrowRight } from "lucide-react";
import { CLAIM_LABELS, CHECKPOINTS } from "@/shared/labels";
import { ClaimChip, Stamp } from "@/components/ui/status";
import type { ClaimLabel } from "@/shared/types";

/** The "how to read Knowlix" panel: so a first-time visitor understands every badge without instructions. */
export function HonestyLegend() {
  return (
    <div className="rounded-2xl border border-rule bg-card p-5 shadow-card">
      <h2 className="text-[1.05rem] font-bold text-ink">How Knowlix keeps you honest</h2>

      <div className="mt-4 flex gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-ok-tint text-ok">
          <ShieldCheck className="size-5" aria-hidden />
        </span>
        <div>
          <p className="font-bold text-ink">Lock 1 · Every reference is checked by code</p>
          <p className="mt-0.5 text-[0.9rem] text-ink-2">doi.org, Crossref and OpenAlex, field by field. No AI decides whether a paper is real.</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3 pl-1">
            <Stamp status="verified" size="sm" />
            <Stamp status="check" size="sm" />
            <Stamp status="mismatch" size="sm" />
          </div>
        </div>
      </div>

      <div className="mt-5 flex gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-neutral-tint text-neutral">
          <Gavel className="size-5" aria-hidden />
        </span>
        <div>
          <p className="font-bold text-ink">Lock 2 · Every AI sentence carries a label</p>
          <p className="mt-0.5 text-[0.9rem] text-ink-2">Quotes, numbers and names are checked by code; a Judge gives one of four fixed answers.</p>
          <ul className="mt-2.5 space-y-2">
            {(Object.keys(CLAIM_LABELS) as ClaimLabel[]).map((l) => (
              <li key={l} className="flex items-start gap-2">
                <ClaimChip label={l} compact className="mt-0.5 shrink-0" />
                <span className="text-[0.85rem] leading-snug text-ink-2">{CLAIM_LABELS[l].description.split(".")[0]}.</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-5 rounded-xl bg-paper px-4 py-3">
        <p className="text-[0.9rem] font-bold text-ink">You approve three times</p>
        <ol className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[0.85rem] text-ink-2">
          {CHECKPOINTS.map((c) => (
            <li key={c.id} className="flex items-center gap-1.5">
              <span className="grid size-5 place-items-center rounded-full bg-card text-[0.72rem] font-bold text-ink tabular">{c.id}</span>
              {c.name}
            </li>
          ))}
        </ol>
      </div>
      <Link href="/how-it-works" className="mt-4 inline-flex items-center gap-1.5 text-[0.9rem] font-semibold text-accent hover:text-accent-hover">
        See the full walkthrough <ArrowRight className="size-4" aria-hidden />
      </Link>
    </div>
  );
}
