"use client";

import { Scale } from "lucide-react";
import type { SourceCandidate } from "@/shared/types";
import { cn, cslVenue, cslYear } from "@/lib/utils";

const BUCKETS: { label: string; test: (age: number) => boolean }[] = [
  { label: "Last 3 years", test: (a) => a <= 3 },
  { label: "4 to 10 years", test: (a) => a > 3 && a <= 10 },
  { label: "Older", test: (a) => a > 10 },
];

/**
 * The source mix: what the chosen sources look like as a set, so a one-sided
 * or narrow selection is visible before anything is written from it.
 */
export function SourceMix({ chosen }: { chosen: SourceCandidate[] }) {
  if (!chosen.length) return null;
  const now = new Date().getFullYear();
  const years = chosen.map((s) => cslYear(s.csl)).filter((y): y is number => typeof y === "number");
  const counts = BUCKETS.map((b) => years.filter((y) => b.test(now - y)).length);
  const venues = chosen.map((s) => cslVenue(s.csl)?.toLowerCase()).filter(Boolean) as string[];
  const venueCount = new Set(venues).size;
  const topVenue = venues.length ? Math.max(...[...new Set(venues)].map((v) => venues.filter((x) => x === v).length)) : 0;
  const open = chosen.filter((s) => s.openAccessUrl).length;
  const preprints = chosen.filter((s) => s.verification?.flags.some((f) => f.code === "preprint") || s.csl.genre === "preprint").length;
  const retracted = chosen.filter((s) => s.verification?.flags.some((f) => f.code === "retracted")).length;
  const fullText = chosen.filter((s) => s.origin === "upload" || s.fullTextAvailable).length;
  const dbs = new Set(chosen.flatMap((s) => s.foundBy.map((f) => f.adapter)).filter((a) => a !== "upload"));

  const notes: string[] = [];
  if (chosen.length < 3) notes.push(`Only ${chosen.length} source${chosen.length === 1 ? "" : "s"}: any conclusion will rest on very little evidence.`);
  if (years.length >= 3 && counts[2] / years.length > 0.6) notes.push("Most are more than 10 years old. Look for newer work.");
  if (chosen.length >= 4 && topVenue / chosen.length >= 0.5) notes.push("Half or more come from the same journal.");
  if (preprints && preprints / chosen.length >= 0.4) notes.push("A large share are preprints, which are not peer reviewed.");
  if (retracted) notes.push(`${retracted} retracted paper${retracted === 1 ? " is" : "s are"} selected. Use ${retracted === 1 ? "it" : "them"} only to discuss the retraction.`);

  const stats: { label: string; value: string; warn?: boolean }[] = [
    { label: "Published", value: years.length ? (Math.min(...years) === Math.max(...years) ? String(years[0]) : `${Math.min(...years)} to ${Math.max(...years)}`) : "Unknown" },
    { label: "Journals or publishers", value: String(venueCount || "Unknown") },
    { label: "Free to read", value: `${open} of ${chosen.length}` },
    { label: "Full text readable", value: `${fullText} of ${chosen.length}` },
    { label: "Preprints", value: String(preprints), warn: preprints / chosen.length >= 0.4 },
    { label: "Found in", value: dbs.size ? `${dbs.size} database${dbs.size === 1 ? "" : "s"}` : "Your PDFs" },
  ];

  return (
    <section className="rounded-2xl border border-rule bg-card px-5 py-4 shadow-card" aria-labelledby="mix-h">
      <h2 id="mix-h" className="flex items-center gap-2 text-[0.98rem] font-bold text-ink">
        <Scale className="size-4.5 text-ink-3" aria-hidden /> Source mix of your {chosen.length} chosen source{chosen.length === 1 ? "" : "s"}
      </h2>
      <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="text-[0.76rem] font-semibold text-ink-3">{s.label}</dt>
            <dd className={cn("text-[1.02rem] font-extrabold tabular", s.warn ? "text-warn" : "text-ink")}>{s.value}</dd>
          </div>
        ))}
      </dl>
      {years.length ? (
        <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-paper-2" role="img" aria-label={BUCKETS.map((b, i) => `${b.label}: ${counts[i]}`).join(", ")}>
          {counts.map((c, i) => (c ? <span key={i} className={cn("h-full", i === 0 ? "bg-accent" : i === 1 ? "bg-[color-mix(in_oklab,var(--accent)_55%,var(--paper-2))]" : "bg-rule-strong")} style={{ width: `${(c / years.length) * 100}%` }} /> : null))}
        </div>
      ) : null}
      {years.length ? (
        <p className="mt-1.5 flex flex-wrap gap-x-4 text-[0.78rem] text-ink-3 tabular">
          {BUCKETS.map((b, i) => (
            <span key={b.label}>
              {b.label}: <strong className="text-ink-2">{counts[i]}</strong>
            </span>
          ))}
        </p>
      ) : null}
      {notes.length ? (
        <ul className="mt-3 space-y-1 rounded-xl bg-warn-tint px-3.5 py-2.5 text-[0.88rem] text-ink">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[0.85rem] text-ink-3">Nothing lopsided stands out. The Critic will look again once the summary is written.</p>
      )}
    </section>
  );
}
