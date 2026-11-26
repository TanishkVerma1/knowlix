import { Suspense } from "react";
import { AuditView } from "@/features/audit/audit-view";
import { Skeleton } from "@/components/ui/misc";

export default function AuditPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-28" />
          <Skeleton className="h-44" />
        </div>
      }
    >
      <AuditView />
    </Suspense>
  );
}
