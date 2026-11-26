"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Cpu, Copy, Download, KeyRound, LogIn, ShieldAlert, Trash, CircleCheck, CircleSlash, Database } from "lucide-react";
import { CITATION_STYLES, POLICY_PRESETS, type CitationStyleId, type Policy } from "@/shared/policy";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn, copyText } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
import { Dialog } from "@/components/ui/overlay";
import { Notice, Skeleton } from "@/components/ui/misc";
import { Connections } from "./connections";

function Toggle({ id, checked, onChange, label, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div>
        <label htmlFor={id} className="font-semibold text-ink">{label}</label>
        {hint ? <p className="text-[0.85rem] text-ink-3">{hint}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors", checked ? "bg-accent" : "bg-rule-strong")}
      >
        <span className={cn("absolute left-0 top-1 size-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-6" : "translate-x-1")} />
      </button>
    </div>
  );
}

function Card({ id, title, description, children }: { id?: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 rounded-2xl border border-rule bg-card p-5 shadow-card sm:p-6" aria-labelledby={`${id ?? title}-h`}>
      <h2 id={`${id ?? title}-h`} className="text-[1.15rem] font-bold text-ink">{title}</h2>
      {description ? <p className="mt-1 text-[0.92rem] text-ink-2">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function SettingsView() {
  const qc = useQueryClient();
  const s = useSession();
  const [draftState, setDraft] = React.useState<Policy | null>(null);
  const [key, setKey] = React.useState<string | null>(null);
  const [joinKey, setJoinKey] = React.useState("");
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleteText, setDeleteText] = React.useState("");

  const draft = draftState ?? s.data?.policy ?? null;

  const save = useMutation({
    mutationFn: (p: Policy) => api<{ policy: Policy }>("/api/policy", { method: "PUT", body: p }),
    onSuccess: (r) => {
      setDraft(r.policy);
      qc.invalidateQueries({ queryKey: ["session"] });
      toast.success("Policy saved", { description: "It applies to every new audit and research run." });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const makeKey = useMutation({ mutationFn: () => api<{ key: string }>("/api/workspace/key", { body: {} }), onSuccess: (r) => { setKey(r.key); qc.invalidateQueries({ queryKey: ["session"] }); }, onError: (e) => toast.error(errorMessage(e)) });
  const join = useMutation({
    mutationFn: () => api("/api/workspace/join", { body: { key: joinKey } }),
    onSuccess: () => {
      toast.success("Workspace opened. Reloading…");
      setTimeout(() => window.location.replace("/"), 600);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const wipe = useMutation({
    mutationFn: () => api("/api/workspace", { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Everything was deleted. Starting a fresh workspace…");
      setTimeout(() => window.location.replace("/"), 900);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!s.data || !draft) return <Skeleton className="h-[30rem]" />;
  const ai = s.data.ai;
  const set = (patch: Partial<Policy>) => setDraft({ ...draft, ...patch, preset: "custom" });
  const dirty = JSON.stringify(draft) !== JSON.stringify(s.data.policy);

  return (
    <div className="space-y-6">
      <Card id="ai" title="Connections" description="Every outside service Knowlix uses, whether it is connected right now, and whether it needs a sign-up.">
        <Connections />
      </Card>
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="min-w-0 space-y-6">
        <Card id="policy" title="Course policy" description="The rules Knowlix enforces on the server. A supervisor or course can require a stricter preset.">
          <div className="grid gap-3 md:grid-cols-3">
            {(Object.entries(POLICY_PRESETS) as [keyof typeof POLICY_PRESETS, (typeof POLICY_PRESETS)[keyof typeof POLICY_PRESETS]][]).map(([id, p]) => (
              <button
                key={id}
                type="button"
                onClick={() => setDraft(p.policy)}
                aria-pressed={draft.preset === id}
                className={cn("rounded-xl border p-4 text-left transition-colors", draft.preset === id ? "border-accent bg-accent-tint" : "border-rule hover:border-rule-strong")}
              >
                <span className="flex items-center justify-between font-bold text-ink">
                  {p.name}
                  {draft.preset === id ? <Check className="size-4 text-accent" aria-hidden /> : null}
                </span>
                <span className="mt-1 block text-[0.85rem] text-ink-2">{p.description}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 divide-y divide-rule">
            <Toggle id="ai-writing" checked={draft.aiWriting} onChange={(v) => set({ aiWriting: v })} label="AI may write summary sentences" hint="Off: summaries are exact quotes only (no-AI mode), even when an AI key exists." />
            <Toggle id="preprints" checked={draft.allowPreprints} onChange={(v) => set({ allowPreprints: v })} label="Allow preprints" hint="Preprints are not peer reviewed. Off: research leaves them out." />
            <Toggle id="overrides" checked={draft.allowOverrides} onChange={(v) => set({ allowOverrides: v })} label="Allow keeping unconfirmed items with a reason" hint="Proven-wrong items can never be kept, whatever this says." />
            <Toggle id="critic" checked={draft.features.critic} onChange={(v) => set({ features: { ...draft.features, critic: v } })} label="Critic reviews every summary" />
            <Toggle id="repair" checked={draft.features.repairLoop} onChange={(v) => set({ features: { ...draft.features, repairLoop: v } })} label="One automatic rewrite for failed sentences" hint="Off: failed sentences are removed straight away." />
            <Toggle id="related" checked={draft.features.relatedPapers} onChange={(v) => set({ features: { ...draft.features, relatedPapers: v } })} label="Related papers in the library" />
          </div>
          <div className="mt-4 grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label htmlFor="min-year">Only sources from</Label>
              <Input id="min-year" type="number" className="mt-1.5 tabular" placeholder="Any year" min={1800} max={2100} value={draft.minYear ?? ""} onChange={(e) => set({ minYear: e.target.value ? Number(e.target.value) : null })} />
            </div>
            <div>
              <Label htmlFor="max-words">Word limit</Label>
              <Input id="max-words" type="number" className="mt-1.5 tabular" min={80} max={600} value={draft.maxSummaryWords} onChange={(e) => set({ maxSummaryWords: Number(e.target.value) || 250 })} />
            </div>
            <div>
              <Label htmlFor="max-sources">Max sources</Label>
              <Input id="max-sources" type="number" className="mt-1.5 tabular" min={3} max={20} value={draft.maxSources} onChange={(e) => set({ maxSources: Number(e.target.value) || 8 })} />
            </div>
            <div>
              <Label htmlFor="style">Default citation style</Label>
              <Select id="style" className="mt-1.5 w-full" value={draft.defaultStyle} onChange={(e) => set({ defaultStyle: e.target.value as CitationStyleId })}>
                {Object.entries(CITATION_STYLES).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </Select>
            </div>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <Button variant="primary" onClick={() => save.mutate(draft)} loading={save.isPending} disabled={!dirty}>
              Save policy
            </Button>
            {dirty ? <Button variant="ghost" onClick={() => setDraft(s.data!.policy)}>Discard changes</Button> : <span className="text-[0.85rem] text-ink-3">Saved</span>}
          </div>
        </Card>

        <Card id="workspace" title="Your workspace" description="No sign-in and no email. Your workspace lives in this browser. Use a key to open it on another device.">
          {key ? (
            <Notice tone="ok" icon={<KeyRound className="size-5" />} title="Your workspace key (shown once)">
              <p className="mt-1 font-record text-[1.05rem] font-bold tracking-wider text-ink">{key}</p>
              <Button size="sm" variant="secondary" className="mt-2" onClick={async () => (await copyText(key)) && toast.success("Key copied")}>
                <Copy className="size-4" aria-hidden /> Copy
              </Button>
              <p className="mt-2 text-[0.85rem]">Keep it private: anyone with this key can open your workspace. Creating a new key disables this one.</p>
            </Notice>
          ) : (
            <Button variant="secondary" onClick={() => makeKey.mutate()} loading={makeKey.isPending}>
              <KeyRound className="size-4" aria-hidden /> {s.data.workspace.hasKey ? "Create a new key" : "Create a workspace key"}
            </Button>
          )}
          <form
            className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (joinKey.trim()) join.mutate();
            }}
          >
            <div className="flex-1">
              <Label htmlFor="join-key">Open another workspace with its key</Label>
              <Input id="join-key" className="mt-1.5 font-record uppercase" placeholder="KNX-XXXX-XXXX-XXXX-XXXX" value={joinKey} onChange={(e) => setJoinKey(e.target.value)} />
            </div>
            <Button type="submit" variant="secondary" loading={join.isPending} disabled={joinKey.trim().length < 10}>
              <LogIn className="size-4" aria-hidden /> Open
            </Button>
          </form>
        </Card>

        <Card id="data" title="Your data" description="Download everything Knowlix holds about you, or erase it.">
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" asChild>
              <a href="/api/workspace" download>
                <Download className="size-4" aria-hidden /> Download all my data (JSON)
              </a>
            </Button>
          </div>
          <div className="mt-6 rounded-xl border border-danger/30 p-4">
            <p className="flex items-center gap-2 font-bold text-danger">
              <ShieldAlert className="size-5" aria-hidden /> Delete my data
            </p>
            <p className="mt-1 text-[0.9rem] text-ink-2">Erases your library, audits, research, AI call records and activity log. The log is append-only for everyone except you; this is the one deletion it allows.</p>
            <Button variant="quiet-danger" className="mt-3" onClick={() => { setDeleteText(""); setConfirmDelete(true); }}>
              <Trash className="size-4" aria-hidden /> Delete everything
            </Button>
          </div>
        </Card>
      </div>

      <aside className="min-w-0 space-y-6">
        <Card id="ai-now" title="AI right now">
          <p className={cn("flex items-center gap-2 font-bold", ai.mode === "ai" ? "text-ok" : "text-warn")}>
            <Cpu className="size-5" aria-hidden />
            {ai.mode === "ai" ? `Active: ${ai.active?.label} · ${ai.active?.model}` : "No-AI mode"}
          </p>
          <ul className="mt-3 space-y-2">
            {ai.providers.map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-[0.9rem]">
                {p.configured ? <CircleCheck className="size-4 text-ok" aria-label="configured" /> : <CircleSlash className="size-4 text-ink-3" aria-label="not configured" />}
                <span className="font-semibold text-ink">{p.label}</span>
                <span className="text-ink-3">{p.configured ? p.model : "not connected"}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[0.85rem] text-ink-2">If the model in use is busy or down, the next one takes over. With no model connected, every reference check still runs and summaries are exact quotes.</p>
        </Card>
        <Card title="What is sent to an AI">
          <ul className="list-disc space-y-1.5 pl-5 text-[0.9rem] text-ink-2">
            <li>Your question, with emails, phone numbers and IDs removed.</li>
            <li>Short numbered passages from source abstracts.</li>
            <li>Never your drafts, uploads, notes or library.</li>
          </ul>
          <p className="mt-3 text-[0.85rem] text-ink-3">Every call is recorded. Open “Sent to the AI” on any research run to see exactly what went out and what came back.</p>
        </Card>
        <Card title="Storage">
          <p className="flex items-center gap-2 text-[0.9rem] text-ink-2">
            <Database className="size-4 text-ink-3" aria-hidden />
            {s.data.db === "postgres" ? "Postgres (server database)" : "Embedded Postgres on this server (PGlite)"}
          </p>
          <p className="mt-1 text-[0.85rem] text-ink-3">Every query is scoped to your workspace. Workspace {s.data.workspace.short}.</p>
        </Card>
      </aside>
    </div>

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete everything?"
        description="This cannot be undone. Type DELETE to confirm."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" disabled={deleteText !== "DELETE"} loading={wipe.isPending} onClick={() => wipe.mutate()}>
              Delete everything
            </Button>
          </>
        }
      >
        <Input value={deleteText} onChange={(e) => setDeleteText(e.target.value)} aria-label="Type DELETE to confirm" placeholder="DELETE" className="font-record" />
      </Dialog>
    </div>
  );
}
