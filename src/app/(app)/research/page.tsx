import { PageHeader } from "@/components/shell/app-shell";
import { Composer } from "@/features/home/composer";
import { RunList } from "@/features/research/run-list";

export const metadata = { title: "Research" };

export default function ResearchPage() {
  return (
    <div>
      <PageHeader
        title="Research a question"
        description="Five roles work in order: the Planner drafts a search, the Finder searches and screens, the Verifier checks every source, the Writer cites passage IDs only, and the Judge and Critic check the result. You approve three times along the way."
      />
      <Composer initialMode="research" />
      <section className="mt-10" aria-labelledby="runs-h">
        <h2 id="runs-h" className="mb-3 text-[1.05rem] font-bold text-ink">Your research</h2>
        <RunList />
      </section>
    </div>
  );
}
