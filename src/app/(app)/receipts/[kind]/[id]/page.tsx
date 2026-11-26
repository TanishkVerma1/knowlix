import { Suspense } from "react";
import { ReceiptView } from "@/features/receipts/receipt-view";
import { Skeleton } from "@/components/ui/misc";

export default function ReceiptPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[40rem]" />}>
      <ReceiptView />
    </Suspense>
  );
}
