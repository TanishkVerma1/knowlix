"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Printer, Link2, Copy, Ban } from "lucide-react";
import type { ReceiptDTO } from "@/server/services/receipts";
import { api, errorMessage } from "@/lib/api";
import { copyText } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { ReceiptDocument } from "./receipt-document";

export function ReceiptView() {
  const { kind, id } = useParams<{ kind: string; id: string }>();
  const qc = useQueryClient();
  const key = ["receipt", kind, id];
  const q = useQuery({ queryKey: key, queryFn: () => api<{ receipt: ReceiptDTO; shareToken: string | null }>(`/api/receipts/${kind}/${id}`) });
  const share = useMutation({
    mutationFn: () => api<{ token: string }>("/api/share", { body: { kind, id } }),
    onSuccess: async ({ token }) => {
      qc.invalidateQueries({ queryKey: key });
      const url = `${window.location.origin}/r/${token}`;
      toast.success((await copyText(url)) ? "Supervisor link copied" : "Supervisor link created", { description: url });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: (token: string) => api("/api/share", { method: "DELETE", body: { token } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      toast.success("Link revoked. It no longer opens.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Skeleton className="h-[40rem]" />;
  if (!q.data) {
    return (
      <EmptyState title="Receipt not available" action={<Button asChild variant="secondary"><Link href="/receipts">All receipts</Link></Button>}>
        {errorMessage(q.error)}
      </EmptyState>
    );
  }
  const link = q.data.shareToken ? `${typeof window !== "undefined" ? window.location.origin : ""}/r/${q.data.shareToken}` : null;
  const back = kind === "audit" ? `/audit/${id}` : `/research/${id}`;

  return (
    <div className="mx-auto max-w-[60rem]">
      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link href={back} className="inline-flex items-center gap-1.5 text-[0.9rem] font-semibold text-ink-3 hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> Back to the {kind === "audit" ? "audit" : "research run"}
        </Link>
        <div className="flex flex-wrap gap-2">
          {link ? (
            <>
              <Button variant="secondary" onClick={async () => (await copyText(link)) && toast.success("Link copied")}>
                <Copy className="size-4" aria-hidden /> Copy supervisor link
              </Button>
              <Button variant="ghost" onClick={() => revoke.mutate(q.data!.shareToken!)} loading={revoke.isPending}>
                <Ban className="size-4" aria-hidden /> Revoke
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => share.mutate()} loading={share.isPending}>
              <Link2 className="size-4" aria-hidden /> Create supervisor link
            </Button>
          )}
          <Button variant="primary" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden /> Print or save PDF
          </Button>
        </div>
      </div>
      <ReceiptDocument r={q.data.receipt} />
    </div>
  );
}
