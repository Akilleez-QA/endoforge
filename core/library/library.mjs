import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Cells } from './cells.mjs';
import { Journal } from './journal.mjs';
import { binding, bindTests, canonical, capabilityFromContract, capabilityFromGlue, keysOf, numerals, ordered, sha256 } from './key.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const digestOf = name => sha256(readFileSync(new URL(`../runtime/x1/${name}`, import.meta.url)));
const verified = rows => new Promise((resolve, reject) => {
  const child = execFile('python3', ['-B', '-m', 'tools.library_verify_promotion'], { cwd: root, timeout: 300000, maxBuffer: 1024 * 1024 * 1024 }, (error, stdout) => {
    if (error) return reject(Error('promotion verifier failed'));
    resolve(stdout.split('\n').filter(Boolean).map(line => JSON.parse(line)));
  });
  child.stdin.end(JSON.stringify(rows));
});
export const frozenHolds = files => {
  try { const frozen = JSON.parse(files['frozen.sha256']); return frozen.contract === sha256(files['CONTRACT.md']) && frozen.tests === sha256(files['tests.json']); }
  catch { return false; }
};
export async function openLibrary({ journal: path = null, cells = 1, deadlineMs = 5000, keyMode = 'contract', gate = 'full' } = {}) {
  const journal = new Journal(path), pool = new Cells({ size: cells, deadlineMs });
  await pool.ready();
  const entries = new Map(), index = new Map(), reuses = new Map(), revoked = new Map();
  const place = entry => {
    entries.set(entry.id, entry);
    const list = index.get(entry.keys[keyMode]) ?? [];
    list.push(entry.id);
    index.set(entry.keys[keyMode], list);
  };
  const classOf = entry => (index.get(entry.keys[keyMode]) ?? []).map(id => entries.get(id)).filter(peer => peer.fingerprint === entry.fingerprint);
  const noteReuse = record => { const list = reuses.get(record.source.candidate) ?? []; list.push(record); reuses.set(record.source.candidate, list); };
  const noteRevoke = record => { for (const id of record.covers) revoked.set(id, record); };
  for (const record of journal.records) {
    if (record.kind === 'library_admit') place(record.entry);
    else if (record.kind === 'library_reuse') noteReuse(record);
    else if (record.kind === 'library_revoke') noteRevoke(record);
    else if (record.kind === 'library_requalify') entries.get(record.id).qualifiedHost = record.host;
  }
  journal.records.length = 0;
  const hostDigest = { gates: digestOf('gates.mjs'), host: digestOf('host.mjs') };
  const candidateFor = (entry, need, tests) => {
    const text = JSON.stringify(tests);
    const files = { 'CONTRACT.md': need.files['CONTRACT.md'], 'tests.json': text, 'frozen.sha256': JSON.stringify({ contract: sha256(need.files['CONTRACT.md']), tests: sha256(text) }), 'kernel.ts': entry.source, 'glue.json': entry.glue };
    return { id: entry.glueId, files, compiled: { source: entry.sourceSha, wasm: entry.wasm } };
  };
  const qualify = (entry, need, tests, level = gate) => pool.run('qualify', { candidate: candidateFor(entry, need, tests), capability: entry.capability, numbers: numerals(need.files['CONTRACT.md']), gate: level });
  const survivors = (discrimination, level) => {
    if (level === 'none') return 0;
    if (!discrimination || discrimination.unsupported) return Infinity;
    return discrimination.survivors.length + (level === 'full' ? discrimination.wrappers.survivors.length + discrimination.bounds.length : 0);
  };
  const library = {
    get size() { return entries.size; },
    entries,
    hostDigest,
    async admit(rows) {
      const outcomes = [], checks = await verified(rows.map(({ ledger, promotion }) => ({ ledger, promotion })));
      for (const [i, check] of checks.entries()) {
        if (!check.ok) { outcomes.push({ admitted: false, reason: check.reason }); continue; }
        const content = JSON.parse(check.content), { files, compiled } = content;
        const wasmSha = sha256(Buffer.from(compiled.wasm ?? '', 'base64'));
        const glue = JSON.parse(files['glue.json']), capability = rows[i].capability ?? capabilityFromGlue(glue);
        if (!compiled.wasm || compiled.source !== sha256(files['kernel.ts']) || !frozenHolds(files)) { outcomes.push({ admitted: false, reason: 'artifact binding differs' }); continue; }
        if (entries.has(check.candidate)) { outcomes.push({ admitted: false, reason: 'already admitted', id: check.candidate }); continue; }
        const qualified = await pool.run('qualify', { candidate: content, capability, numbers: [], gate: 'none' });
        if (!qualified.result?.promotable) { outcomes.push({ admitted: false, reason: 'own evaluator failed under the current gates' }); continue; }
        const numbers = numerals(files['CONTRACT.md']), print = await pool.run('fingerprint', { wasm: compiled.wasm, capability: ordered(capability), numbers: [] });
        if (!print.result) { outcomes.push({ admitted: false, reason: 'fingerprint failed' }); continue; }
        const entry = { id: check.candidate, glueId: content.id, wasm: compiled.wasm, wasmSha, source: files['kernel.ts'], sourceSha: compiled.source, glue: files['glue.json'],
          capability, keys: keysOf(capability, files['CONTRACT.md']), fingerprint: sha256(canonical(print.result)), own: { contract: files['CONTRACT.md'], tests: files['tests.json'] }, qualifiedHost: hostDigest,
          promotion: { decision: check.decision, candidate: check.candidate, frozenEvaluator: check.frozenEvaluator, evaluatorDigest: check.evaluatorDigest, chainTip: check.chainTip, receipt: check.receipt, gates: check.gates, host: check.host },
          label: rows[i].label };
        journal.append({ kind: 'library_admit', entry });
        place(entry);
        outcomes.push({ admitted: true, id: entry.id, duplicateOf: classOf(entry).find(peer => peer.id !== entry.id)?.id ?? null, hostMatches: check.gates === hostDigest.gates && check.host === hostDigest.host });
      }
      return outcomes;
    },
    lookup(need, { mode = keyMode, excludeRun = null } = {}) {
      if (!frozenHolds(need.files)) return { status: 'miss', reason: 'need_not_frozen' };
      const capability = need.capability ?? capabilityFromContract(need.files['CONTRACT.md']);
      if (!capability) return { status: 'miss', reason: 'no_capability' };
      const key = keysOf(capability, need.files['CONTRACT.md'])[mode];
      const held = mode === keyMode ? (index.get(key) ?? []).map(id => entries.get(id)) : [...entries.values()].filter(e => e.keys[mode] === key);
      const visible = held.filter(entry => !excludeRun || entry.label?.run !== excludeRun);
      const current = visible.filter(entry => !revoked.has(entry.id));
      const active = current.filter(entry => canonical(entry.qualifiedHost) === canonical(hostDigest));
      if (!visible.length) return { status: 'miss', reason: 'no_contract_match', key };
      if (!current.length) return { status: 'miss', reason: 'revoked', key };
      if (!active.length) return { status: 'miss', reason: 'needs_requalification', key };
      if (new Set(active.map(entry => entry.fingerprint)).size > 1) return { status: 'miss', reason: 'ambiguous_key', key, classes: new Set(active.map(entry => entry.fingerprint)).size };
      const entry = active[0];
      if (sha256(Buffer.from(entry.wasm, 'base64')) !== entry.wasmSha) return { status: 'miss', reason: 'artifact_tampered', key };
      const map = binding(capability, entry.capability);
      if (!map) return { status: 'miss', reason: 'no_binding', key };
      const tests = bindTests(JSON.parse(need.files['tests.json']), map);
      if (tests.some(test => test === null)) return { status: 'miss', reason: 'unbound_test', key };
      return { status: 'hit', key, entry, binding: map, tests, capability, duplicates: active.length - 1 };
    },
    qualify,
    survivors,
    async serve(need) {
      const found = library.lookup(need);
      if (found.status !== 'hit') return { verdict: 'miss', reason: found.reason, key: found.key ?? null };
      const { entry, tests, key, binding: map } = found;
      const run = await qualify(entry, need, tests);
      const result = run.result ?? null, base = { need: { id: need.id ?? null, contract: sha256(need.files['CONTRACT.md']), tests: sha256(need.files['tests.json']), frozen: sha256(need.files['frozen.sha256']) },
        source: entry.promotion, wasm: entry.wasmSha, sourceSha: entry.sourceSha, key, binding: map, host: hostDigest,
        gates: result?.gates ?? null, discrimination: result?.discrimination ? { ...result.discrimination, survivors: result.discrimination.survivors.length, wrappers: { ...result.discrimination.wrappers, survivors: result.discrimination.wrappers.survivors.length }, bounds: result.discrimination.bounds.length } : null };
      const reason = run.error ?? (!result.promotable ? 'evaluator_failed' : survivors(result.discrimination, gate) > 0 ? 'evaluator_cannot_discriminate' : null);
      if (reason) {
        const refusal = { kind: 'library_refused', reason, ...base };
        journal.append(refusal);
        return { verdict: 'refused', reason, receipt: refusal };
      }
      const receipt = { kind: 'library_reuse', ...base };
      const crossing = journal.append(receipt);
      noteReuse(receipt);
      return { verdict: 'pass', receipt, hash: crossing.hash, candidate: candidateFor(entry, need, tests) };
    },
    revoke(id, reason) {
      const entry = entries.get(id);
      if (!entry) throw Error('unknown kernel');
      const covers = classOf(entry).map(peer => peer.id);
      const record = { kind: 'library_revoke', id, reason, covers };
      journal.append(record);
      noteRevoke(record);
      return { covers, dependants: covers.flatMap(cover => reuses.get(cover) ?? []) };
    },
    async requalify() {
      const outcome = { passed: [], retired: [] };
      for (const entry of entries.values()) {
        if (revoked.has(entry.id) || canonical(entry.qualifiedHost) === canonical(hostDigest)) continue;
        const need = { files: { 'CONTRACT.md': entry.own.contract } };
        const run = await qualify(entry, need, JSON.parse(entry.own.tests), 'none');
        if (run.result?.promotable) {
          journal.append({ kind: 'library_requalify', id: entry.id, host: hostDigest });
          entry.qualifiedHost = hostDigest;
          outcome.passed.push(entry.id);
        } else {
          library.revoke(entry.id, 'no passing qualification against the current host');
          outcome.retired.push(entry.id);
        }
      }
      return outcome;
    },
    dependants(id) { return reuses.get(id) ?? []; },
    isRevoked(id) { return revoked.has(id); },
    async close() { await pool.close(); journal.close(); },
  };
  return library;
}
