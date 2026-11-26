"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/overlay";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/field";
import { api, errorMessage } from "@/lib/api";

/** "Report a wrong check": checks can be wrong too, and students must be able to say so. */
export function ReportDialog({ open, onOpenChange, subjectType, subjectId, context }: { open: boolean; onOpenChange: (o: boolean) => void; subjectType: string; subjectId: string; context?: string }) {
  const [note, setNote] = React.useState("");
  const m = useMutation({
    mutationFn: () => api("/api/reports", { body: { subjectType, subjectId, note } }),
    onSuccess: () => {
      toast.success("Thanks, your report was recorded", { description: "It is saved in your activity log and on the receipt." });
      setNote("");
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Report a wrong check"
      description="Automatic checks can be wrong. Tell us what looks off; the report is kept in your activity log so a supervisor can see you flagged it."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={note.trim().length < 5} loading={m.isPending} onClick={() => m.mutate()}>
            Send report
          </Button>
        </>
      }
    >
      {context ? <p className="rounded-lg bg-paper px-3 py-2 font-record text-[0.85rem] text-ink-2 [overflow-wrap:anywhere]">{context}</p> : null}
      <Label htmlFor="report-note" className="mt-4 block">What looks wrong?</Label>
      <Textarea id="report-note" className="mt-1.5" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. This paper is real. It is in the 2019 print edition of the journal." maxLength={2000} />
    </Dialog>
  );
}
