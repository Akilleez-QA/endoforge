import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Cells } from './cells.mjs';
import { Journal } from './journal.mjs';
import { binding, bindTests, canonical, capabilityFromContract, capabilityFromGlue, contractVector, keysOf, numerals, ordered, sha256, signatures, similarity } from './key.mjs';
import { accepted } from './discriminate.mjs';
import { buildComposition, partsOf } from './compose.mjs';
import { LinkError } from './link.mjs';
import { access, mayGrant } from './scope.mjs';
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
const SEMANTIC_THRESHOLD = 0.4;
const RELEASED = ['wasm', 'source', 'glue', 'own'];
const released = entry => ({ ...entry, ...Object.fromEntries(RELEASED.map(field => [field, null])) });
const sameScope = (a, b) => canonical(a.scope ?? null) === canonical(b.scope ?? null);
export async function openLibrary({ journal: path = null, cells = 1, deadlineMs = 5000, keyMode = 'contract', gate = 'full', retrieval = 'key', principal: defaultPrincipal = null, environment: environmentOverride = null } = {}) {
  const journal = new Journal(path), pool = new Cells({ size: cells, deadlineMs });
  await pool.ready();
  const entries = new Map(), index = new Map(), reuses = new Map(), revoked = new Map(), vectors = new Map(), grants = new Map(), examples = new Map(), refusedPairs = new Map();
  const environment = environmentOverride ?? { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch };
  const environmentId = sha256(canonical(environment));
  const place = entry => {
    entries.set(entry.id, entry);
    if (entry.own) vectors.set(entry.id, contractVector(entry.own.contract));
    const list = index.get(entry.keys[keyMode]) ?? [];
    list.push(entry.id);
    index.set(entry.keys[keyMode], list);
  };
  const classOf = entry => (index.get(entry.keys[keyMode]) ?? []).map(id => entries.get(id)).filter(peer => peer.fingerprint === entry.fingerprint && sameScope(peer, entry));
  const noteReuse = record => { const list = reuses.get(record.source.candidate) ?? []; list.push(record); reuses.set(record.source.candidate, list); };
  const noteCompose = record => { for (const source of record.sources) noteReuse({ ...record, source }); };
  const noteRevoke = record => { for (const id of record.covers) revoked.set(id, record); };
  const kept = id => {
    const seen = new Set();
    while (entries.get(id)?.reclaimedInto && !seen.has(id)) { seen.add(id); id = entries.get(id).reclaimedInto; }
    return id;
  };
  const noteGrant = record => {
    const id = kept(record.id), list = (grants.get(id) ?? []).filter(grant => canonical(grant) !== canonical(record.grantee));
    if (record.kind === 'library_grant') list.push(record.grantee);
    grants.set(id, list);
  };
  const examplesKey = (environment, id) => canonical([environment ?? null, id]);
  const noteRefusal = record => {
    if (!record.entryId) return;
    const key = examplesKey(record.environment, record.entryId), known = examples.get(key) ?? new Map();
    for (const example of record.counterexamples ?? []) known.set(canonical([example.fn, example.args]), example);
    examples.set(key, known);
    if (record.pair) refusedPairs.set(record.pair, { reason: record.reason, witnesses: record.witnesses ?? [] });
  };
  const noteReclaim = record => {
    const entry = entries.get(record.id);
    RELEASED.forEach(field => { entry[field] = null; });
    entry.reclaimedInto = record.into;
    vectors.delete(record.id);
    const into = kept(record.into), moved = grants.get(record.id) ?? [];
    if (moved.length) grants.set(into, [...(grants.get(into) ?? []).filter(grant => !moved.some(other => canonical(other) === canonical(grant))), ...moved]);
    grants.delete(record.id);
  };
  const noteQualification = record => {
    const entry = entries.get(record.id);
    if (record.ok !== false) entry.qualifiedHost = record.host;
    if (record.environmentId) entry.qualifications = { ...entry.qualifications, [record.environmentId]: { environment: record.environment, ok: record.ok !== false, host: record.host } };
  };
  for (const record of journal.records) {
    if (record.kind === 'library_admit') place(record.entry);
    else if (record.kind === 'library_reuse') noteReuse(record);
    else if (record.kind === 'library_compose') noteCompose(record);
    else if (record.kind === 'library_refused') noteRefusal(record);
    else if (record.kind === 'library_revoke') noteRevoke(record);
    else if (record.kind === 'library_grant' || record.kind === 'library_ungrant') noteGrant(record);
    else if (record.kind === 'library_reclaim') noteReclaim(record);
    else if (record.kind === 'library_requalify') noteQualification(record);
  }
  journal.records.length = 0;
  const hostDigest = { gates: digestOf('gates.mjs'), host: digestOf('host.mjs') };
  const qualifiedHere = entry => canonical(entry.qualifiedHost) === canonical(hostDigest) && entry.qualifications?.[environmentId]?.ok === true;
  const usable = (entry, principal) => !entry.reclaimedInto && !revoked.has(entry.id) && qualifiedHere(entry) && access(entry, principal, grants) === 'allow';
  const rank = (text, principal, excludeRun) => {
    const wanted = contractVector(text), rows = [];
    for (const entry of entries.values()) {
      if (entry.reclaimedInto || revoked.has(entry.id) || access(entry, principal, grants) === 'foreign' || (excludeRun && entry.label?.run === excludeRun)) continue;
      const score = similarity(wanted, vectors.get(entry.id));
      if (score > 0) rows.push({ id: entry.id, score });
    }
    return rows.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  };
  const pairOf = (id, tests, contract) => sha256(canonical([id, tests, numerals(contract), gate, hostDigest, environmentId]));
  const examplesHere = id => [...new Map([...(examples.get(examplesKey(null, id)) ?? []), ...(examples.get(examplesKey(environmentId, id)) ?? [])]).values()];
  const knownRefusal = (id, tests, contract) => {
    const pair = refusedPairs.get(pairOf(id, tests, contract));
    if (pair) return { refused: pair.reason, witnesses: pair.witnesses, counterexamples: examplesHere(id) };
    const matched = examplesHere(id).filter(example => tests.some(test => test.fn === example.fn && canonical(test.args) === canonical(example.args) && !accepted(test, example.trap ? { trap: true } : { value: example.got })));
    return matched.length ? { refused: 'evaluator_failed', witnesses: [], counterexamples: matched } : null;
  };
  const refusalDetail = (id, tests, contract, result, reason, usedCell) => {
    if (!usedCell) return {};
    const discrimination = result.discrimination, survivors = discrimination ? [...discrimination.survivors, ...discrimination.wrappers.survivors] : [];
    return { entryId: id, environment: environmentId, pair: pairOf(id, tests, contract), counterexamples: reason === 'evaluator_failed' ? result.failing ?? [] : [], witnesses: survivors.slice(0, 16).map(({ kind, fn, args }) => ({ kind, fn, args })) };
  };
  const unionPlan = (capability, contract, principal, excludeRun) => {
    if (capability.exports.length < 2) return null;
    const allowed = new Set(numerals(contract)), order = rank(contract, principal, excludeRun).map(row => entries.get(row.id));
    const pool = [...order, ...[...entries.values()].filter(entry => !order.includes(entry))].filter(entry => usable(entry, principal) && !(excludeRun && entry.label?.run === excludeRun) && numerals(entry.own.contract).every(value => allowed.has(value)));
    const planned = [];
    for (const wanted of signatures(capability)) {
      const match = pool.map(entry => [entry, signatures(entry.capability).filter(item => item.text === wanted.text)]).find(([, held]) => held.length);
      if (!match) return null;
      const [entry, held] = match;
      planned.push({ name: wanted.name, entry: entry.id, fn: (held.find(item => item.name === wanted.name) ?? held[0]).name });
    }
    return new Set(planned.map(item => item.entry)).size > 1 ? { exports: planned } : null;
  };
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
  const judged = (entry, need, tests, run, base, passKind, details = {}) => {
    const result = run.result ?? null;
    const summary = { ...base, gates: result?.gates ?? null, discrimination: result?.discrimination ? { ...result.discrimination, survivors: result.discrimination.survivors.length, wrappers: { ...result.discrimination.wrappers, survivors: result.discrimination.wrappers.survivors.length }, bounds: result.discrimination.bounds.length } : null };
    const reason = run.error ?? (!result.promotable ? 'evaluator_failed' : survivors(result.discrimination, gate) > 0 ? 'evaluator_cannot_discriminate' : null);
    if (reason) {
      const detail = refusalDetail(entry.id, tests, need.files['CONTRACT.md'], result, reason, !run.error);
      const refusal = { kind: 'library_refused', reason, ...summary, ...detail };
      journal.append(refusal);
      noteRefusal(refusal);
      return { verdict: 'refused', reason, receipt: refusal, counterexamples: detail.counterexamples ?? [], witnesses: detail.witnesses ?? [] };
    }
    const receipt = { kind: passKind, ...summary, ...details };
    const crossing = journal.append(receipt);
    return { verdict: 'pass', receipt, hash: crossing.hash, candidate: candidateFor(entry, need, tests) };
  };
  const needRecord = need => ({ id: need.id ?? null, contract: sha256(need.files['CONTRACT.md']), tests: sha256(need.files['tests.json']), frozen: sha256(need.files['frozen.sha256']) });
  const library = {
    get size() { let live = 0; for (const entry of entries.values()) if (!entry.reclaimedInto) live++; return live; },
    entries,
    hostDigest,
    environment,
    environmentId,
    retrieve(text, { principal = defaultPrincipal, excludeRun = null } = {}) { return rank(text, principal, excludeRun); },
    qualifications(id) { return entries.get(id)?.qualifications ?? {}; },
    counterexamples(id) { return examplesHere(id); },
    grant(id, grantee, { by = defaultPrincipal } = {}) {
      const entry = entries.get(kept(id));
      if (!entry) throw Error('unknown kernel');
      mayGrant(entry, by);
      const record = { kind: 'library_grant', id, grantee, by };
      journal.append(record);
      noteGrant(record);
    },
    ungrant(id, grantee, { by = defaultPrincipal } = {}) {
      const entry = entries.get(kept(id));
      if (!entry) throw Error('unknown kernel');
      mayGrant(entry, by);
      const record = { kind: 'library_ungrant', id, grantee, by };
      journal.append(record);
      noteGrant(record);
    },
    reclaim({ compact = true } = {}) {
      const groups = new Map();
      for (const entry of entries.values()) {
        if (entry.reclaimedInto || revoked.has(entry.id) || !qualifiedHere(entry)) continue;
        const group = canonical([entry.keys[keyMode], entry.fingerprint, entry.scope ?? null, entry.label?.run ?? null]);
        groups.set(group, [...(groups.get(group) ?? []), entry]);
      }
      const outcome = { reclaimed: [], bytes: 0 };
      for (const [survivor, ...twins] of groups.values()) for (const entry of twins) {
        const bytes = RELEASED.reduce((total, field) => total + JSON.stringify(entry[field]).length, 0);
        const record = { kind: 'library_reclaim', id: entry.id, into: survivor.id, bytes };
        journal.append(record);
        noteReclaim(record);
        outcome.reclaimed.push({ id: entry.id, into: survivor.id });
        outcome.bytes += bytes;
      }
      if (compact && outcome.reclaimed.length) journal.compact(record => record.kind === 'library_admit' && entries.get(record.entry.id)?.reclaimedInto ? { ...record, entry: released(record.entry) } : record);
      return outcome;
    },
    async admit(rows) {
      const outcomes = [], checks = await verified(rows.map(({ ledger, promotion }) => ({ ledger, promotion })));
      for (const [i, check] of checks.entries()) {
        if (!check.ok) { outcomes.push({ admitted: false, reason: check.reason }); continue; }
        const content = JSON.parse(check.content), { files, compiled } = content;
        const wasmSha = sha256(Buffer.from(compiled.wasm ?? '', 'base64'));
        const glue = JSON.parse(files['glue.json']), capability = rows[i].capability ?? capabilityFromGlue(glue), scope = rows[i].scope ?? defaultPrincipal;
        if (!compiled.wasm || compiled.source !== sha256(files['kernel.ts']) || !frozenHolds(files)) { outcomes.push({ admitted: false, reason: 'artifact binding differs' }); continue; }
        if (entries.has(check.candidate)) { outcomes.push({ admitted: false, reason: 'already admitted', id: check.candidate }); continue; }
        const qualified = await pool.run('qualify', { candidate: content, capability, numbers: [], gate: 'none' });
        if (!qualified.result?.promotable) { outcomes.push({ admitted: false, reason: 'own evaluator failed under the current gates' }); continue; }
        const numbers = numerals(files['CONTRACT.md']), print = await pool.run('fingerprint', { wasm: compiled.wasm, capability: ordered(capability), numbers: [] });
        if (!print.result) { outcomes.push({ admitted: false, reason: 'fingerprint failed' }); continue; }
        const entry = { id: check.candidate, glueId: content.id, wasm: compiled.wasm, wasmSha, source: files['kernel.ts'], sourceSha: compiled.source, glue: files['glue.json'],
          capability, keys: keysOf(capability, files['CONTRACT.md']), fingerprint: sha256(canonical(print.result)), own: { contract: files['CONTRACT.md'], tests: files['tests.json'] }, qualifiedHost: hostDigest,
          qualifications: { [environmentId]: { environment, ok: true, host: hostDigest } }, ...(scope ? { scope } : {}),
          promotion: { decision: check.decision, candidate: check.candidate, frozenEvaluator: check.frozenEvaluator, evaluatorDigest: check.evaluatorDigest, chainTip: check.chainTip, receipt: check.receipt, gates: check.gates, host: check.host },
          label: rows[i].label };
        journal.append({ kind: 'library_admit', entry });
        place(entry);
        outcomes.push({ admitted: true, id: entry.id, duplicateOf: classOf(entry).find(peer => peer.id !== entry.id)?.id ?? null, hostMatches: check.gates === hostDigest.gates && check.host === hostDigest.host });
      }
      return outcomes;
    },
    lookup(need, { mode = keyMode, excludeRun = null, principal = defaultPrincipal } = {}) {
      if (!frozenHolds(need.files)) return { status: 'miss', reason: 'need_not_frozen' };
      const contract = need.files['CONTRACT.md'];
      const retrieved = retrieval === 'semantic' ? rank(contract, principal, excludeRun) : null;
      let capability = need.capability ?? capabilityFromContract(contract);
      let renamedTests = null;
      if (!capability && retrieved) {
        const wantedTests = JSON.parse(need.files['tests.json']), wantedNames = [...new Set(wantedTests.map(test => test.fn))];
        for (const { id, score } of retrieved) {
          if (score < SEMANTIC_THRESHOLD) break;
          const entry = entries.get(id), candidateCapability = entry.capability;
          if (access(entry, principal, grants) !== 'allow' || keysOf(candidateCapability, contract)[mode] !== entry.keys[mode]) continue;
          const held = candidateCapability.exports.map(item => item.name);
          if (wantedNames.every(name => held.includes(name))) { capability = candidateCapability; break; }
          if (wantedNames.length === 1 && held.length === 1) { capability = { ...candidateCapability, exports: [{ ...candidateCapability.exports[0], name: wantedNames[0] }], traps: (candidateCapability.traps ?? []).map(() => wantedNames[0]) }; renamedTests = wantedNames[0]; break; }
        }
      }
      if (!capability) return { status: 'miss', reason: 'no_capability' };
      const key = keysOf(capability, contract)[mode];
      const held = (mode === keyMode ? (index.get(key) ?? []).map(id => entries.get(id)) : [...entries.values()].filter(e => e.keys[mode] === key)).filter(entry => !entry.reclaimedInto);
      const inTenant = held.filter(entry => access(entry, principal, grants) !== 'foreign');
      const allowed = inTenant.filter(entry => access(entry, principal, grants) === 'allow');
      if (inTenant.length && !allowed.length) return { status: 'miss', reason: 'permission_denied', key };
      const visible = allowed.filter(entry => !excludeRun || entry.label?.run !== excludeRun);
      if (retrieved) { const order = new Map(retrieved.map((row, at) => [row.id, at])); visible.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity)); }
      const current = visible.filter(entry => !revoked.has(entry.id));
      const active = current.filter(qualifiedHere);
      if (!visible.length) return { status: 'miss', reason: 'no_contract_match', key, nearest: (retrieved ?? rank(contract, principal, excludeRun)).slice(0, 3) };
      if (!current.length) return { status: 'miss', reason: 'revoked', key };
      if (!active.length) return { status: 'miss', reason: 'needs_requalification', key };
      if (new Set(active.map(entry => entry.fingerprint)).size > 1) return { status: 'miss', reason: 'ambiguous_key', key, classes: new Set(active.map(entry => entry.fingerprint)).size };
      const entry = active[0];
      if (sha256(Buffer.from(entry.wasm, 'base64')) !== entry.wasmSha) return { status: 'miss', reason: 'artifact_tampered', key };
      const map = binding(capability, entry.capability);
      if (!map) return { status: 'miss', reason: 'no_binding', key };
      const tests = bindTests(JSON.parse(need.files['tests.json']), map);
      if (tests.some(test => test === null)) return { status: 'miss', reason: 'unbound_test', key };
      const known = knownRefusal(entry.id, tests, contract);
      if (known) return { status: 'miss', reason: 'counterexample', key, ...known };
      return { status: 'hit', key, entry, binding: map, tests, capability, duplicates: active.length - 1, ...(retrieved ? { retrieved: retrieved.slice(0, 3) } : {}), ...(renamedTests ? { adopted: entry.id } : {}) };
    },
    qualify,
    survivors,
    async serve(need, { principal = defaultPrincipal } = {}) {
      const found = library.lookup(need, { principal });
      if (found.status !== 'hit') {
        if (found.reason === 'no_contract_match') {
          const capability = need.capability ?? capabilityFromContract(need.files['CONTRACT.md']);
          const plan = capability && unionPlan(capability, need.files['CONTRACT.md'], principal, null);
          if (plan) return library.compose(need, plan, { principal });
        }
        return { verdict: 'miss', reason: found.reason, key: found.key ?? null, ...(found.counterexamples ? { counterexamples: found.counterexamples, witnesses: found.witnesses, refused: found.refused } : {}) };
      }
      const { entry, tests, key, binding: map } = found;
      const run = await qualify(entry, need, tests);
      const base = { need: needRecord(need), source: entry.promotion, wasm: entry.wasmSha, sourceSha: entry.sourceSha, key, binding: map, host: hostDigest, environment: environmentId, ...(principal ? { principal } : {}) };
      const outcome = judged(entry, need, tests, run, base, 'library_reuse');
      if (outcome.verdict === 'pass') noteReuse(outcome.receipt);
      return outcome;
    },
    async compose(need, plan, { principal = defaultPrincipal } = {}) {
      const miss = reason => ({ verdict: 'miss', reason, key: null });
      if (!frozenHolds(need.files)) return miss('need_not_frozen');
      const contract = need.files['CONTRACT.md'], capability = need.capability ?? capabilityFromContract(contract);
      if (!capability) return miss('no_capability');
      const parts = new Map();
      for (const named of partsOf(plan)) {
        let entry = entries.get(named);
        if (entry?.reclaimedInto) entry = entries.get(entry.reclaimedInto);
        if (!entry) return miss('unknown_part');
        if (access(entry, principal, grants) !== 'allow') return miss('permission_denied');
        if (revoked.has(entry.id)) return miss('revoked');
        if (!qualifiedHere(entry)) return miss('needs_requalification');
        if (sha256(Buffer.from(entry.wasm, 'base64')) !== entry.wasmSha) return miss('artifact_tampered');
        parts.set(named, entry);
      }
      let built;
      try { built = buildComposition({ plan, capability, parts }); }
      catch (error) { if (error instanceof LinkError) return { ...miss(error.reason), detail: error.message }; throw error; }
      const tests = JSON.parse(need.files['tests.json']), known = knownRefusal(built.id, tests, contract);
      if (known) return { ...miss('counterexample'), ...known };
      const sources = [...new Set(parts.values())].map(entry => entry.promotion);
      const run = await qualify(built, need, tests);
      const base = { need: needRecord(need), source: sources[0], sources, plan, wasm: built.wasmSha, sourceSha: built.sourceSha, key: built.id, host: hostDigest, environment: environmentId, ...(principal ? { principal } : {}) };
      const outcome = judged(built, need, tests, run, base, 'library_compose');
      if (outcome.verdict === 'pass') noteCompose(outcome.receipt);
      return outcome;
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
      const outcome = { passed: [], retired: [] }, failed = [];
      for (const entry of entries.values()) {
        if (entry.reclaimedInto || revoked.has(entry.id) || qualifiedHere(entry)) continue;
        const hostMoved = canonical(entry.qualifiedHost) !== canonical(hostDigest);
        const need = { files: { 'CONTRACT.md': entry.own.contract } };
        const run = await qualify(entry, need, JSON.parse(entry.own.tests), 'none');
        if (run.result?.promotable) {
          const record = { kind: 'library_requalify', id: entry.id, host: hostDigest, environment, environmentId, ok: true };
          journal.append(record);
          noteQualification(record);
          outcome.passed.push(entry.id);
        } else if (hostMoved) {
          library.revoke(entry.id, 'no passing qualification against the current host');
          outcome.retired.push(entry.id);
        } else {
          const record = { kind: 'library_requalify', id: entry.id, host: hostDigest, environment, environmentId, ok: false };
          journal.append(record);
          noteQualification(record);
          failed.push(entry.id);
        }
      }
      return failed.length ? { ...outcome, failed } : outcome;
    },
    dependants(id) { return reuses.get(id) ?? []; },
    isRevoked(id) { return revoked.has(id); },
    async close() { await pool.close(); journal.close(); },
  };
  return library;
}
