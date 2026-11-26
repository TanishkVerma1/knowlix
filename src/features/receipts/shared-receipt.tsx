"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import type { ReceiptDTO } from "@/server/services/receipts";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { ReceiptDocument } from "./receipt-document";

export function SharedReceipt() {
  const { token } = useParams<{ token: string }>();
  const q = useQuery({ queryKey: ["shared", token], queryFn: () => api<ReceiptDTO>(`/api/share/${token}`), retry: false });
  if (q.isLoading) return <Skeleton className="h-[40rem]" />;
  if (!q.data) return <EmptyState title="This receipt is not available">{errorMessage(q.error)}</EmptyState>;
  return (
    <div>
      <div className="no-print mb-4 flex justify-end">
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden /> Print or save PDF
        </Button>
      </div>
      <ReceiptDocument r={q.data} publicView />
    </div>
  );
}
