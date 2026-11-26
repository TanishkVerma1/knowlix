import { Suspense } from "react";
import { SharedReceipt } from "@/features/receipts/shared-receipt";
import { Skeleton } from "@/components/ui/misc";

export const metadata = { title: "Shared honesty receipt", robots: { index: false } };

export default function SharedReceiptPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[40rem]" />}>
      <SharedReceipt />
    </Suspense>
  );
}
