// End-to-end smoke test against a running Knowlix (local or deployed).
//   npm run smoke                       → http://localhost:3000
//   npm run smoke -- https://your.app   → any deployment
// Exercises: health, Citation Audit (sample list), library, research (all 3 checkpoints), export, activity log chain.
const base = (process.argv[2] ?? process.env.KNOWLIX_URL ?? "http://localhost:3000").replace(/\/$/, "");
let cookie = "";
let failures = 0;

async function call(path, { method, body, stream } = {}) {
  const res = await fetch(base + path, {
    method: method ?? (body ? "POST" : "GET"),
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  if (stream) return { status: res.status, events: text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) };
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, text };
}

function check(name, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const t0 = Date.now();
const health = await call("/api/health");
check("health", health.status === 200 && health.json?.ok === true && Boolean(health.json?.database), `db=${health.json?.database?.driver} ai=${health.json?.ai?.mode}`);

if (!health.json?.database) {
  console.log(`
That is not a Knowlix server (or it is down): ${base}`);
  process.exit(1);
}
const session = await call("/api/session");
check("workspace cookie", session.status === 200 && Boolean(session.json?.workspace?.id));

const audit = await call("/api/audits", { body: { sample: true } });
check("create sample audit", audit.status === 200, `${audit.json?.count} references`);
const run = await call(`/api/audits/${audit.json.auditId}/run`, { method: "POST", stream: true });
const done = run.events.find((e) => e.type === "done");
check("audit stream", Boolean(done), done ? `verified ${done.summary.verified}, check ${done.summary.check}, mismatch ${done.summary.mismatch}` : "no done event");
check("sample catches the invented references", done && done.summary.mismatch >= 2);
const locked = await call(`/api/audits/${audit.json.auditId}/export`);
check("export locked while red items remain", locked.status === 423);

const full = await call(`/api/audits/${audit.json.auditId}`);
for (const item of full.json.items.filter((i) => i.status === "mismatch")) {
  await call(`/api/audits/${audit.json.auditId}/items/${item.id}`, { method: "PATCH", body: { action: "remove" } });
}
const stillLocked = await call(`/api/audits/${audit.json.auditId}/export`);
check("unconfirmed items still need a decision", stillLocked.status === 423 || !full.json.items.some((i) => i.status === "check"));
for (const item of full.json.items.filter((i) => i.status === "check")) {
  await call(`/api/audits/${audit.json.auditId}/items/${item.id}`, { method: "PATCH", body: { action: "keep", reason: "Smoke test: kept on purpose to test the receipt." } });
}
const unlocked = await call(`/api/audits/${audit.json.auditId}/export?style=apa`);
check("export unlocks once every item is decided", unlocked.status === 200, `${unlocked.json?.count} references in APA`);
const lib = await call(`/api/audits/${audit.json.auditId}/library`, { body: {} });
check("save to library", lib.status === 200, `${lib.json?.added} added`);

const r = await call("/api/research", { body: { question: "Does retrieval practice improve long-term retention compared with re-reading?" } });
check("checkpoint 1: plan", r.status === 200 && r.json?.state === "plan_review", `${r.json?.plan?.queries?.length} searches, mode ${r.json?.mode}`);
const early = await call(`/api/research/${r.json.id}/write`, { method: "POST" });
check("server refuses to skip checkpoints", early.status === 409);
await call(`/api/research/${r.json.id}/plan`, { body: { queries: r.json.plan.queries, approve: true } });
const search = await call(`/api/research/${r.json.id}/search`, { method: "POST", stream: true });
const sdone = search.events.find((e) => e.type === "done");
check("checkpoint 2: verified sources", Boolean(sdone?.run?.sources?.length), `${sdone?.run?.sources?.length ?? 0} candidates`);
const accepted = (sdone?.run?.sources ?? []).filter((s) => s.accepted).map((s) => s.id);
const chosen = await call(`/api/research/${r.json.id}/sources`, { body: { accepted } });
check("approve sources", chosen.status === 200, `${accepted.length} chosen`);
const write = await call(`/api/research/${r.json.id}/write`, { method: "POST", stream: true });
const wdone = write.events.find((e) => e.type === "done");
const stats = wdone?.run?.draft?.stats;
check("checkpoint 3: labelled summary", Boolean(stats), stats ? JSON.stringify(stats) : write.events.find((e) => e.type === "error")?.message);
const approved = await call(`/api/research/${r.json.id}/approve`, { method: "POST" });
check("approve summary", approved.status === 200 && approved.json?.state === "approved");
const exp = await call(`/api/research/${r.json.id}/export?style=apa`);
check("export summary + references", exp.status === 200 && exp.json?.references?.length > 20);

// The retracted sample paper: its own record cannot be used to wave the warning away.
const retractedItem = full.json.items.find((i) => i.result?.flags?.some((f) => f.code === "retracted"));
if (retractedItem) {
  await call(`/api/audits/${audit.json.auditId}/items/${retractedItem.id}`, { method: "PATCH", body: { action: "undo" } });
  const swap = await call(`/api/audits/${audit.json.auditId}/items/${retractedItem.id}`, { method: "PATCH", body: { action: "replace" } });
  check("a retracted paper cannot be made Verified by swapping in its own record", swap.status === 409, swap.json?.error?.code);
}

// Draft: citations resolve only to library references; an unknown key is refused in plain sight.
const libItems = (await call("/api/library")).json?.items ?? [];
const keyOf = (i) => {
  const name = (i.firstAuthor ?? i.title.split(/\s+/)[0] ?? "Source").normalize("NFKD").replace(/[^A-Za-z0-9]/g, "");
  return `${name.charAt(0).toUpperCase()}${name.slice(1, 24)}${i.year ?? "nd"}`;
};
// A reference whose key is unique in the library, so no a/b suffix is involved.
const first = libItems.find((i) => libItems.filter((j) => keyOf(j).toLowerCase() === keyOf(i).toLowerCase()).length === 1);
const draft = await call("/api/draft", { method: "PUT", body: { title: "Smoke", style: "apa", body: `A sourced sentence${first ? ` [@${keyOf(first)}]` : ""}. An invented one [@Nobody2099].` } });
const rendered = draft.json?.rendered;
check("draft: an unknown citation key is flagged, never formatted", draft.status === 200 && rendered?.stats?.unknown === 1 && rendered.notes.some((n) => n.kind === "unknown-key"));
check("draft: a library reference is cited and listed", !first || (rendered?.references?.length >= 1 && /\(/.test(rendered.paragraphs[0])), `${rendered?.references?.length ?? 0} reference(s)`);

// Live planning: the run page opens in "planning" and the plan arrives over a stream.
const live = await call("/api/research", { body: { question: "Does sleep help memory consolidation in students?", live: true } });
check("live run starts in planning", live.status === 200 && live.json?.state === "planning");
if (process.env.SMOKE_SKIP_LIVE_PLAN !== "1") {
  const drafted = await call(`/api/research/${live.json.id}/draft`, { method: "POST", stream: true });
  const pdone = drafted.events.find((e) => e.type === "done");
  check("planner stream ends at checkpoint 1", pdone?.run?.state === "plan_review", `${pdone?.run?.plan?.queries?.length ?? 0} searches`);
  const again = await call(`/api/research/${live.json.id}/draft`, { method: "POST" });
  check("planning cannot be replayed after the checkpoint", again.status === 409);
}

const act = await call("/api/activity");
check("activity log hash chain intact", act.json?.chain?.intact === true, `${act.json?.chain?.count} entries`);
const tamper = await call("/api/activity/tamper-test", { method: "POST" });
check("database refuses to edit the log", tamper.json?.refused === true, tamper.json?.message);

console.log(`\n${failures ? `${failures} check(s) FAILED` : "All checks passed"} in ${((Date.now() - t0) / 1000).toFixed(1)} s against ${base}`);
process.exit(failures ? 1 : 0);
