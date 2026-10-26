// The measurements every run receipt carries (`receipt/run.json` → `lessons`), so a round's lessons exist without
// anyone remembering to collect them (Craig, 2026-10-26: "iterate measure learn improve repeat"): failed launches,
// retries and failovers, the slowest atom, and queue waits (ready → started, i.e. concurrency or throttle).
/** receipts: { [atomId]: { attempts: [{ attempt, exit, signal, timedOut, ok, wallMs, failovers? }], readyAt, startedAt, wallMs } } */
export function runLessons(receipts, { throttled = 0 } = {}) {
  const recs = Object.entries(receipts);
  const failedLaunches = recs.flatMap(([id, r]) => (r.attempts ?? []).filter((a) => !a.ok)
    .map((a) => ({ atom: id, attempt: a.attempt, exit: a.exit ?? null, ...(a.signal ? { signal: a.signal } : {}), ...(a.timedOut ? { timedOut: true } : {}), reason: a.reason ?? (a.stderrTail ? a.stderrTail.trim().split('\n').at(-1).slice(0, 200) : null) })));
  const retries = recs.filter(([, r]) => (r.attempts ?? []).filter((a) => !a.preflight).length > 1).map(([id, r]) => ({ atom: id, attempts: r.attempts.length }));
  const failovers = recs.flatMap(([id, r]) => (r.attempts ?? []).flatMap((a) => (a.failovers ?? []).map((f) => ({ atom: id, account: f.account, class: f.class }))));
  const slow = recs.reduce((m, [id, r]) => ((r.wallMs ?? 0) > (m?.wallMs ?? -1) ? { atom: id, wallMs: r.wallMs ?? 0 } : m), null);
  const waits = recs.map(([id, r]) => ({ atom: id, ms: Math.max(0, Date.parse(r.startedAt) - Date.parse(r.readyAt)) })).filter((w) => Number.isFinite(w.ms));
  const longest = waits.reduce((m, w) => (w.ms > (m?.ms ?? -1) ? w : m), null);
  return { failedLaunches, retries, failovers, slowestAtom: slow,
    queueWaits: { totalMs: waits.reduce((s, w) => s + w.ms, 0), max: longest, throttled } };
}
