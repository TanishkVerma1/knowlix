import { AI_SUGGESTION, CLAIM_LEGEND, REFERENCE_LEGEND, type LegendEntry } from "@/shared/labels";
import { toneChip } from "@/components/ui/status";
import { cn } from "@/lib/utils";

/**
 * "What the labels mean", shown on every screen that carries a label, so nobody
 * has to guess how far to trust a reference or a sentence.
 */
export function TrustLegend({ show, className }: { show: ("references" | "claims" | "suggestion")[]; className?: string }) {
  return (
    <>
      <Legend show={show} open className={cn("hidden md:block", className)} />
      <Legend show={show} open={false} className={cn("md:hidden", className)} />
    </>
  );
}

function Legend({ show, className, open }: { show: ("references" | "claims" | "suggestion")[]; className?: string; open: boolean }) {
  const entries: LegendEntry[] = [...(show.includes("references") ? REFERENCE_LEGEND : []), ...(show.includes("suggestion") ? [AI_SUGGESTION] : []), ...(show.includes("claims") ? CLAIM_LEGEND : [])];
  return (
    <details open={open} className={cn("no-print rounded-2xl border border-rule bg-card px-4 py-3", className)}>
      <summary className="cursor-pointer text-[0.92rem] font-bold text-ink">
        What the labels mean
        <span className="ml-2 font-normal text-ink-3">{entries.map((e) => e.name).join(" · ")}</span>
      </summary>
      <ul className="mt-3 grid gap-x-6 gap-y-2.5 md:grid-cols-2">
        {entries.map((e) => (
          <li key={e.name} className="flex flex-col items-start gap-1 sm:flex-row sm:gap-2.5">
            <span className={cn("shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[0.78rem] font-bold leading-none", toneChip[e.tone])}>{e.name}</span>
            <span className="text-[0.86rem] leading-snug text-ink-2">{e.meaning}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
