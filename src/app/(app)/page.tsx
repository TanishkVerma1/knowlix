import { Composer } from "@/features/home/composer";
import { RecentWork } from "@/features/home/recent";
import { HonestyLegend } from "@/features/home/honesty-legend";
import { TeamStrip } from "@/features/home/team-strip";
import { RegisterRule } from "@/components/shell/app-shell";

export default function HomePage() {
  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_23rem]">
      <div className="min-w-0">
        <h1 className="max-w-[46rem] text-[1.9rem] font-black leading-[1.06] text-ink sm:text-[2.45rem]">
          Every reference checked. <span className="text-accent">Nothing invented.</span>
        </h1>
        <RegisterRule className="mt-5" />
        <p className="mt-4 max-w-[42rem] text-[1.08rem] text-ink-2">
          Paste a reference list and Knowlix stamps each one against real scholarly records, or ask a question and research it with AI agents that can only cite what they can trace.
        </p>
        <div className="mt-7">
          <Composer autoFocus />
        </div>
        <div className="mt-8">
          <TeamStrip />
        </div>
        <section className="mt-10" aria-labelledby="recent-h">
          <h2 id="recent-h" className="mb-3 text-[1.05rem] font-bold text-ink">
            Recent work
          </h2>
          <RecentWork />
        </section>
      </div>
      <aside className="min-w-0">
        <HonestyLegend />
      </aside>
    </div>
  );
}
