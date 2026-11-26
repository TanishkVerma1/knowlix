import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shell/app-shell";
import { CaseBrowser, type BenchCase } from "@/features/testset/case-browser";
import data from "@/shared/benchmark-cases.json";

export const metadata = { title: "The test set" };

interface Totals {
  cases: number;
  exact: number;
  exactPct: number;
  fakes: number;
  fakesNotVerified: number;
  fakesProvenWrong?: number;
  real: number;
  realWronglyMismatch: number;
  imperfect: number;
  imperfectWronglyMismatch: number;
  errors: number;
}
interface Category {
  id: string;
  name: string;
  description: string;
  kind: string;
  cases: number;
  correct: number;
}
interface File {
  generatedAt: string | null;
  seed: number | string | null;
  provenance: string;
  totals: Totals | null;
  categories: Category[];
  cases: BenchCase[];
}

function Tile({ value, label, note, tone = "ink" }: { value: string; label: string; note: string; tone?: "ink" | "ok" }) {
  return (
    <div className="rounded-2xl border border-rule bg-card p-5 shadow-card">
      <p className={tone === "ok" ? "text-[2.1rem] font-extrabold leading-none text-ok tabular" : "text-[2.1rem] font-extrabold leading-none text-ink tabular"}>{value}</p>
      <p className="mt-2 font-bold text-ink">{label}</p>
      <p className="mt-0.5 text-[0.85rem] text-ink-2">{note}</p>
    </div>
  );
}

export default function TestSetPage() {
  const file = data as unknown as File;
  const t = file.totals;
  const names = Object.fromEntries(file.categories.map((c) => [c.id, c.name]));
  return (
    <div className="max-w-[68rem]">
      <Link href="/how-it-works" className="mb-4 inline-flex items-center gap-1.5 text-[0.9rem] font-semibold text-ink-3 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> How it works
      </Link>
      <PageHeader
        title="The test set"
        description="Every reference our accuracy numbers rest on, with the stamp it should get and the stamp Knowlix gave. Nothing here was used to train anything: Knowlix has no trained model for checking references, only rules and live database lookups. This is its exam."
      />

      {t ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Tile value={String(t.cases)} label="test references" note={`${t.real} real, ${t.imperfect} real with an honest slip, ${t.fakes} invented.`} />
            <Tile value={`${t.fakes - t.fakesNotVerified} of ${t.fakes}`} label="invented references stamped Verified" note="The error that matters most: a fake let through. Lower is better." tone={t.fakes - t.fakesNotVerified === 0 ? "ok" : "ink"} />
            <Tile value={`${t.realWronglyMismatch + t.imperfectWronglyMismatch} of ${t.real + t.imperfect}`} label="real references stamped Mismatch" note="The opposite error: accusing a real paper. Lower is better." tone={t.realWronglyMismatch + t.imperfectWronglyMismatch === 0 ? "ok" : "ink"} />
            <Tile value={`${Math.round(t.exactPct * (t.exactPct <= 1 ? 100 : 1))}%`} label="got exactly the right stamp" note={t.errors ? `${t.errors} could not be checked because a database did not answer; they are counted as not correct.` : "Counting every case, including the awkward ones."} />
          </div>

          <section className="mt-8 rounded-2xl border border-rule bg-card p-6 shadow-card" aria-labelledby="where-h">
            <h2 id="where-h" className="text-[1.2rem] font-extrabold text-ink">Where the data comes from</h2>
            <p className="mt-2 max-w-[56rem] text-[0.95rem] leading-relaxed text-ink-2">{file.provenance}</p>
            <p className="mt-3 text-[0.85rem] text-ink-3">
              {file.generatedAt ? `Last run ${new Date(file.generatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}. ` : ""}
              Rebuild and re-run it yourself: <span className="font-record text-ink-2">npm run bench:generated</span>. The files are in <span className="font-record text-ink-2">bench/data</span>.
            </p>
          </section>

          <section className="mt-8" aria-labelledby="cat-h">
            <h2 id="cat-h" className="text-[1.2rem] font-extrabold text-ink">The kinds of case</h2>
            <div className="mt-3 overflow-x-auto rounded-2xl border border-rule bg-card shadow-card">
              <table className="w-full min-w-[42rem] text-left text-[0.9rem]">
                <thead className="bg-card-2 text-[0.78rem] text-ink-3">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Kind of case</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">What it tests</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">Correct</th>
                  </tr>
                </thead>
                <tbody>
                  {file.categories.map((c) => (
                    <tr key={c.id} className="border-t border-rule align-top">
                      <th scope="row" className="px-4 py-3 font-bold text-ink">{c.name}</th>
                      <td className="px-4 py-3 text-ink-2">{c.description}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-bold tabular">
                        <span className={c.correct === c.cases ? "text-ok" : "text-warn"}>{c.correct}</span>
                        <span className="text-ink-3"> / {c.cases}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-8" aria-labelledby="cases-h">
            <h2 id="cases-h" className="mb-3 text-[1.2rem] font-extrabold text-ink">Every test reference</h2>
            <CaseBrowser cases={file.cases} categories={names} />
          </section>
        </>
      ) : (
        <p className="rounded-2xl border border-dashed border-rule-strong px-6 py-10 text-center text-ink-2">
          The large test set has not been run on this copy yet. Run <span className="font-record">npm run bench:generated</span> to build and score it.
        </p>
      )}
    </div>
  );
}
