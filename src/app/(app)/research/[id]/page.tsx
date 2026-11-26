import { Suspense } from "react";
import { RunView } from "@/features/research/run-view";
import { Skeleton } from "@/components/ui/misc";

export default function RunPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-16" />
          <Skeleton className="h-72" />
        </div>
      }
    >
      <RunView />
    </Suspense>
  );
}
