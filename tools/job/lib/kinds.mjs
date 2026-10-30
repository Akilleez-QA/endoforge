// Job kinds are DATA, outside the core: tools/job/kinds/<kind>.json (and any directory in ENDOFORGE_JOB_KINDS). This
// engine only interprets a fixed set of universal rule shapes; it knows nothing about any domain.
//   proxyCheckKinds                 check kinds that measure a proxy: they must be labelled and calibrated (I3)
//   splitByTests                    a split is proven by tests passing before and after (I6)
//   requireCheckKinds               [{ kind, inv, why }]: at least one criterion with a check of this kind
//   requireAnyCheckKind             [{ kinds, inv, why }]: at least one criterion with a check of one of these kinds
//   measureReferencesGoverning      { aspects, checkKind, inv, why }: each reference governing one of these aspects
//                                   needs a check of checkKind against it
//   requireCheckField               [{ kind, field, inv, why }]: some check of this kind must set this field
//   requiresTruth                   { inv, pattern?, why }: a truth package, with an entry matching pattern if given
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIRS = [path.join(path.dirname(fileURLToPath(import.meta.url)), '../kinds'), ...(process.env.ENDOFORGE_JOB_KINDS ?? '').split(':').filter(Boolean)];
export const KINDS = {};
for (const d of DIRS) {
  let files = []; try { files = fs.readdirSync(d).filter((f) => f.endsWith('.json')); } catch { continue; }
  for (const f of files) { const k = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')); KINDS[k.id] = withChecks(k); }
}

const kindOf = (x, k) => x.criteria.filter((c) => c.check?.kind === k);
function withChecks(k) {
  const decide = (job, x) => [
    ...(k.requireCheckKinds ?? []).filter((r) => !kindOf(x, r.kind).length).map((r) => [r.inv ?? 'I3', r.why]),
    ...(k.requireAnyCheckKind ?? []).filter((r) => !r.kinds.some((kk) => kindOf(x, kk).length)).map((r) => [r.inv ?? 'I3', r.why]),
    ...(k.requireCheckField ?? []).filter((r) => !kindOf(x, r.kind).some((c) => c.check[r.field] != null)).map((r) => [r.inv ?? 'I3', r.why]),
    ...(k.measureReferencesGoverning ? x.refs.filter((ref) => (ref.governs ?? []).some((g) => k.measureReferencesGoverning.aspects.includes(g)))
      .filter((ref) => !kindOf(x, k.measureReferencesGoverning.checkKind).some((c) => c.check.reference === ref.id))
      .map((ref) => [k.measureReferencesGoverning.inv ?? 'I3', `reference ${ref.id} governs ${ref.governs.join(', ')}: ${k.measureReferencesGoverning.why}`]) : []),
  ];
  const observe = (job) => {
    const t = k.requiresTruth; if (!t || !(job.truth ?? []).length) return [];
    return !t.pattern || job.truth.some((e) => new RegExp(t.pattern, 'i').test(`${e.id} ${e.what}`)) ? [] : [[t.inv ?? 'I4', t.why]];
  };
  return { ...k, requiresTruth: Boolean(k.requiresTruth), checks: { decide, observe } };
}

/** Check kinds that measure a proxy for this job (its kind's list, plus any check marked proxy: true). */
export const proxyKinds = (job) => KINDS[job?.kind]?.proxyCheckKinds ?? KINDS.generic?.proxyCheckKinds ?? [];
