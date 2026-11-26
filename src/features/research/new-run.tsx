"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Compass } from "lucide-react";
import type { RunDTO } from "@/server/services/research";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";

/** Creates the run (the Planner drafts the plan) and moves on to checkpoint 1. */
export function NewRun() {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const [error, setError] = React.useState<string | null>(null);
  const started = React.useRef(false);

  React.useEffect(() => {
    if (started.current || !q) return;
    started.current = true;
    api<RunDTO>("/api/research", { body: { question: q, live: true } })
      .then((run) => router.replace(`/research/${run.id}`))
      .catch((e) => setError(errorMessage(e)));
  }, [q, router]);

  if (!q || error) {
    return (
      <EmptyState title={error ? "The plan could not be drafted" : "No question given"} action={<Button asChild variant="secondary"><Link href="/research">Back to Research</Link></Button>}>
        {error ?? "Type a research question to begin."}
      </EmptyState>
    );
  }
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-neutral-tint text-neutral">
        <Compass className="size-7 animate-[spin_3s_linear_infinite]" aria-hidden />
      </span>
      <h1 className="mt-5 text-2xl font-extrabold text-ink">Opening the agent room…</h1>
      <p className="mt-2 text-ink-2">“{q}”</p>
      <p className="mt-4 text-[0.9rem] text-ink-3">Nothing is searched until you approve the plan.</p>
    </div>
  );
}
