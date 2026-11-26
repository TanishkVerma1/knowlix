"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleMinus, ExternalLink, LoaderCircle, TriangleExclamationPoint } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

interface Health {
  services: Record<string, { ok: boolean; ms: number; error?: string }>;
  config: { contactEmail: boolean; openAlexKey: boolean; semanticScholarKey?: boolean; googleBooksKey?: boolean };
}

type State = "on" | "off" | "limited" | "checking";

interface Row {
  name: string;
  does: string;
  state: State;
  status: string;
  /** What the person running Knowlix has to do, if anything. */
  signup: string;
  href?: string;
  env?: string;
}

const STATE: Record<State, { Icon: typeof CircleCheck; cls: string }> = {
  on: { Icon: CircleCheck, cls: "text-ok" },
  off: { Icon: CircleMinus, cls: "text-ink-3" },
  limited: { Icon: TriangleExclamationPoint, cls: "text-warn" },
  checking: { Icon: LoaderCircle, cls: "text-ink-3 animate-spin" },
};

function Table({ caption, rows }: { caption: string; rows: Row[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-rule">
      <table className="w-full min-w-[44rem] text-left text-[0.9rem]">
        <caption className="border-b border-rule bg-card-2 px-4 py-2 text-left text-[0.82rem] font-bold text-ink-2">{caption}</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Service</th>
            <th scope="col">Status</th>
            <th scope="col">Sign-up</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = STATE[r.state];
            return (
              <tr key={r.name} className="border-t border-rule align-top first:border-t-0">
                <th scope="row" className="w-[36%] px-4 py-3 font-normal">
                  <span className="block font-bold text-ink">{r.name}</span>
                  <span className="block text-[0.84rem] text-ink-2">{r.does}</span>
                </th>
                <td className="w-[26%] px-4 py-3">
                  <span className="flex items-start gap-1.5 font-semibold text-ink">
                    <s.Icon className={cn("mt-0.5 size-4 shrink-0", s.cls)} aria-hidden />
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-[0.86rem] text-ink-2">
                  {r.signup}
                  {r.env ? (
                    <>
                      {" "}
                      Setting: <span className="font-record text-[0.8rem] text-ink">{r.env}</span>
                    </>
                  ) : null}
                  {r.href ? (
                    <a href={r.href} target="_blank" rel="noreferrer" className="mt-0.5 flex w-fit items-center gap-1 font-semibold text-accent hover:underline">
                      {r.href.replace(/^https?:\/\//, "").replace(/\/$/, "")} <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Every outside service Knowlix talks to: is it connected, and does anyone need to sign up for it? */
export function Connections() {
  const session = useSession();
  const health = useQuery({ queryKey: ["health"], queryFn: () => api<Health>("/api/health"), staleTime: 5 * 60_000, refetchOnWindowFocus: false });
  const providers = session.data?.ai.providers ?? [];
  const provider = (id: string) => providers.find((p) => p.id === id);
  const active = session.data?.ai.active?.id;

  const svc = (id: string, opts: { keyed?: boolean; keyless: string }): { state: State; status: string } => {
    if (health.isLoading) return { state: "checking", status: "Checking…" };
    const h = health.data?.services[id];
    if (!h) return { state: "off", status: "Not checked" };
    if (h.ok) return { state: "on", status: opts.keyed ? "Connected with your key" : opts.keyless };
    return { state: "limited", status: /resting|slow down|too many|429/i.test(h.error ?? "") ? "Resting: free limit reached" : "Not answering right now" };
  };
  const cfg = health.data?.config;

  const ai: Row[] = [
    {
      name: "Groq",
      does: "Runs the five AI agents on a fast cloud model. An answer takes a few seconds.",
      state: provider("groq")?.configured ? "on" : "off",
      status: provider("groq")?.configured ? `${active === "groq" ? "In use" : "Connected"} · ${provider("groq")?.model}` : "No key yet",
      signup: "Free account, about two minutes. Create an API key and paste it into the server settings.",
      href: "https://console.groq.com/keys",
      env: "GROQ_API_KEY",
    },
    {
      name: "Google Gemini",
      does: "Back-up model: takes over automatically if Groq is busy or down.",
      state: provider("gemini")?.configured ? "on" : "off",
      status: provider("gemini")?.configured ? `${active === "gemini" ? "In use" : "Standing by"} · ${provider("gemini")?.model}` : "No key yet",
      signup: "Free with a Google account.",
      href: "https://aistudio.google.com/apikey",
      env: "GEMINI_API_KEY",
    },
    {
      name: "Ollama, on this computer",
      does: "A model that runs locally. Nothing leaves the laptop, but an answer takes minutes, not seconds.",
      state: provider("ollama")?.configured ? "on" : "off",
      status: provider("ollama")?.configured ? `${active === "ollama" ? "In use" : "Standing by"} · ${provider("ollama")?.model}` : "Not set up",
      signup: "No sign-up. Works only where Ollama is installed, so not on a hosted site.",
      env: "OLLAMA_BASE_URL",
    },
  ];

  const data: Row[] = [
    { name: "doi.org", does: "The worldwide DOI register: proves a DOI exists.", ...svc("doi.org", { keyless: "Connected" }), signup: "No sign-up." },
    {
      name: "Crossref",
      does: "Official records for journal articles, plus retraction and correction notices.",
      ...svc("crossref", { keyed: cfg?.contactEmail, keyless: "Connected (shared pool)" }),
      status: health.data?.services.crossref?.ok ? (cfg?.contactEmail ? "Connected (polite pool)" : "Connected (shared pool)") : svc("crossref", { keyless: "" }).status,
      signup: cfg?.contactEmail ? "No sign-up. A contact email is set, which gives steadier access." : "No sign-up, but add a team contact email: without it, a busy network can be told to slow down.",
      env: cfg?.contactEmail ? undefined : "CONTACT_EMAIL",
    },
    {
      name: "OpenAlex",
      does: "A second opinion on every record, abstracts, citation counts and related papers.",
      ...svc("openalex", { keyed: cfg?.openAlexKey, keyless: "Connected (small shared budget)" }),
      signup: cfg?.openAlexKey ? "Your free key is set." : "Works without a key on a small daily budget that runs out. A free key gives you your own, ten times larger.",
      href: cfg?.openAlexKey ? undefined : "https://openalex.org/settings/api-key",
      env: cfg?.openAlexKey ? undefined : "OPENALEX_API_KEY",
    },
    { name: "Europe PMC", does: "Search with abstracts, and the full text of open-access papers.", ...svc("europepmc", { keyless: "Connected" }), signup: "No sign-up." },
    {
      name: "Semantic Scholar",
      does: "An extra search database with abstracts.",
      ...svc("semanticscholar", { keyed: cfg?.semanticScholarKey, keyless: "Connected (shared pool)" }),
      signup: cfg?.semanticScholarKey ? "Your key is set." : "Optional. Works without a key but is often busy. A free key arrives by email after a short form.",
      href: cfg?.semanticScholarKey ? undefined : "https://www.semanticscholar.org/product/api#api-key-form",
      env: cfg?.semanticScholarKey ? undefined : "SEMANTIC_SCHOLAR_API_KEY",
    },
    { name: "arXiv", does: "Preprints, used only when your policy allows them.", ...svc("arxiv", { keyless: "Connected" }), signup: "No sign-up." },
    {
      name: "Open Library and Google Books",
      does: "Book records, for references that have no DOI.",
      ...svc("googlebooks", { keyed: cfg?.googleBooksKey, keyless: "Connected" }),
      status: health.isLoading ? "Checking…" : health.data?.services.googlebooks?.ok ? "Both connected" : "Open Library only",
      state: health.isLoading ? "checking" : health.data?.services.googlebooks?.ok ? "on" : "limited",
      signup: cfg?.googleBooksKey ? "Your Google Books key is set." : "Open Library needs nothing. Google Books is optional and needs a free Google Cloud key.",
      href: cfg?.googleBooksKey ? undefined : "https://console.cloud.google.com/apis/credentials",
      env: cfg?.googleBooksKey ? undefined : "GOOGLE_BOOKS_API_KEY",
    },
  ];

  return (
    <div className="space-y-4">
      <Table caption="AI models: tried in this order; the first one connected is used, the next is the fall-back" rows={ai} />
      <Table caption="Scholarly databases: where every fact about a reference comes from" rows={data} />
      <p className="text-[0.85rem] text-ink-3">
        Keys are server settings (the file <span className="font-record text-ink-2">.env.local</span>, or your host&rsquo;s environment variables). They never reach the browser. After adding one, restart the app.
      </p>
    </div>
  );
}
