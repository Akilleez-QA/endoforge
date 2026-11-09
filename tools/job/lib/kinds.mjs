import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIRS = [path.join(path.dirname(fileURLToPath(import.meta.url)), '../kinds'), ...(process.env.ENDOFORGE_JOB_KINDS ?? '').split(':').filter(Boolean)];
const RULE_KEYS = ['id', 'note', 'proxyCheckKinds', 'splitByTests', 'requireCheckKinds', 'requireAnyCheckKind', 'measureReferencesGoverning', 'requireCheckField', 'requiresTruth'];
export const KINDS = Object.create(null);
for (const d of DIRS) {
  let files = []; try { files = fs.readdirSync(d).filter((f) => f.endsWith('.json')); } catch { continue; }
  for (const f of files) {
    const file = path.join(d, f), k = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!k || typeof k !== 'object' || typeof k.id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(k.id)) throw new Error(`job kind ${file}: id must be a lower-case name`);
    const unknown = Object.keys(k).filter((key) => !RULE_KEYS.includes(key));
    if (unknown.length) throw new Error(`job kind ${file}: unknown rule ${unknown.join(', ')} (known: ${RULE_KEYS.join(', ')})`);
    KINDS[k.id] = withChecks(k);
  }
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

export const proxyKinds = (job) => KINDS[job?.kind]?.proxyCheckKinds ?? KINDS.generic?.proxyCheckKinds ?? [];
