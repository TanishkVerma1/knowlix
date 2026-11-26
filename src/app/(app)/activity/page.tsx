import { PageHeader } from "@/components/shell/app-shell";
import { ActivityView } from "@/features/activity/activity-view";

export const metadata = { title: "Activity log" };

export default function ActivityPage() {
  return (
    <div>
      <PageHeader title="Activity log" description="Every check, decision and AI step, in order. Append-only and hash-chained, so history cannot be rewritten." />
      <ActivityView />
    </div>
  );
}
