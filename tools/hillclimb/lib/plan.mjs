// Build the Endoforge atoms for a round: review (consult → critique → compose) and fix (one atom per owner → compose).
import { SCHEMA as FIXLIST_SCHEMA, byOwner } from './fixlist.mjs';
import { roundName, vars, expand } from './campaign.mjs';

const ROUND = '/hc';          // the round directory, read-only: stills/, sheets/, previous.fixlist.json
const TOOL = '/hc-tool';      // this tool, read-only (scripts/hc-patch.sh, bin/hillclimb.mjs)
const REPO = '/repo';         // the campaign repo, read-only (fix atoms copy their scope out of it)

function binds(c, n, { repo = false } = {}) {
  const v = vars(c, n);
  const b = [{ host: v.roundDir, guest: ROUND }, { host: v.tool, guest: TOOL }];
  if (repo && c.repo) b.push({ host: c.repo, guest: REPO });
  for (const r of c.references?.binds ?? []) b.push(expand(r, v));
  return b;
}

const ownersText = (c) => Object.entries(c.owners).map(([k, o]) => `- ${k}: ${o.describe}`).join('\n');
const refsText = (c) => (c.references?.index ?? []).map((p) => `- ${p}`).join('\n') || '- (none declared)';

/** Review round: consult the references for what the stills show, then critique, then a script checks the list. */
export function reviewAtoms(c, n, { hasPrevious = false } = {}) {
  const model = c.critique?.model ?? 'opus';
  const b = binds(c, n);
  const research = c.references?.research;
  const consult = {
    id: 'consult', kind: 'other', title: 'Consult references and find new ones',
    contract: [
      `Campaign ${c.id}: ${c.goal}`,
      `Look at every contact sheet in ${ROUND}/sheets/ (index ${ROUND}/sheets/index.json; full stills in ${ROUND}/stills/).`,
      hasPrevious ? `The previous round's fix list is ${ROUND}/previous.fixlist.json; check which of its problems the stills still show.` : 'This is the first round; there is no previous fix list.',
      'For every visible weak spot, consult the reference material and note which references settle how it should look:', refsText(c),
      research?.allow
        ? `Then search for NEW references for weak spots the pack does not cover. Allowed sources: ${(research.sources ?? []).join(', ')}. Allowed licences: ${(research.licences ?? []).join(', ')}. Record each candidate's URL, title, source, licence and the subject it documents. Do not download anything; the host fetches approved candidates.`
        : 'Do not search the web this campaign; consult only the declared references.',
      'Write /out/references.json: {"consulted": [{"subject", "stills": [...], "references": [...], "finding"}], "new": [{"url", "title", "source", "licence", "subject", "why"}]} and /out/consult.md (short prose).',
    ].join('\n'),
    inputs: [{ from: 'need' }],
    outputs: [{ name: 'references', path: 'references.json' }, { name: 'consult', path: 'consult.md' }],
    verify: 'references.json parses and has consulted and new lists',
    worker: { model, tools: ['Read', 'Bash', 'Glob', 'Grep', 'Write', ...(research?.allow ? ['WebSearch', 'WebFetch'] : [])], timeoutSec: c.critique?.timeoutSec ?? 2400, binds: b,
      prompt: 'Work in /work, write outputs to /out. Follow the contract exactly.' },
    size: { work: 3, interface: 1 },
  };
  const critique = {
    id: 'critique', kind: 'other', title: `Find up to ${c.critique.count} problems`,
    contract: [
      `Campaign ${c.id}: ${c.goal}`,
      `Find up to ${c.critique.count} concrete, correctable problems in the stills (${ROUND}/sheets/, ${ROUND}/stills/), judged against the references in /in/consult/references.json and the rubric:`,
      c.critique.rubric ?? '(no rubric given: judge realism, accuracy to the references, and readability)',
      'Owners (each problem goes to exactly one; pick the lane that would make the fix):', ownersText(c),
      hasPrevious ? `Compare with ${ROUND}/previous.fixlist.json: mark a problem still visible with carried_from=<its previous id>, and list previous ids no longer visible in resolved_from_previous.` : 'First round: carried_from is null for all items and resolved_from_previous is [].',
      'Be specific: name the still, where in the frame, and what is wrong. Do not invent problems you cannot see. Order by severity.',
      `Write /out/fixlist.json: {"schema": "${FIXLIST_SCHEMA}", "round": ${n}, "summary": "<2-3 sentences>", "items": [{"id": 1, "still": "<name>", "problem": "<what is wrong, where>", "owner": "<key>", "severity": "blocker|major|minor", "needs_reference": false, "carried_from": null}], "resolved_from_previous": []}`,
    ].join('\n'),
    inputs: [{ from: 'consult', output: 'references' }],
    outputs: [{ name: 'fixlist', path: 'fixlist.json' }],
    verify: 'fixlist.json passes hillclimb check-fixlist',
    worker: { model, tools: ['Read', 'Bash', 'Glob', 'Write'], timeoutSec: c.critique?.timeoutSec ?? 2400, binds: b, prompt: 'Work in /work, write outputs to /out. Follow the contract exactly.' },
    size: { work: 3, interface: 1 },
  };
  const compose = {
    id: 'compose', kind: 'compose', title: 'Check the fix list and write the round files',
    contract: 'Validate fixlist.json against the campaign owners and count, then write FIXLIST.md and score.json for the round.',
    inputs: [{ from: 'critique', output: 'fixlist' }, { from: 'consult', output: 'references' }],
    outputs: [{ name: 'fixlist_md', path: 'FIXLIST.md' }, { name: 'score', path: 'score.json' }],
    verify: 'FIXLIST.md and score.json exist',
    worker: { model: 'script', toolchain: ['node'], binds: b,
      command: ['node', `${TOOL}/bin/hillclimb.mjs`, 'compose-review', `${ROUND}/campaign.json`, '/in/critique/fixlist.json', '/out', ...(hasPrevious ? ['--previous', `${ROUND}/previous.fixlist.json`] : [])] },
    size: { work: 1, interface: 1 },
  };
  return doc(c, n, 'review', `Round ${n} review of ${c.id}: consult the references, then find up to ${c.critique.count} problems in the stills.`, [consult, critique, compose],
    'compose wrote FIXLIST.md and score.json', "test -s /in/compose/FIXLIST.md && test -s /in/compose/score.json");
}

/** Fix round: one atom per owner with open items; each returns a patch confined to its scope plus a per-item report. */
export function fixAtoms(c, n, fixlist) {
  const groups = byOwner(fixlist);
  const atoms = [];
  for (const [owner, items] of Object.entries(groups)) {
    const o = c.owners[owner];
    atoms.push({
      id: `fix-${owner.toLowerCase()}`, kind: 'other', title: `Fix lane ${owner}: ${items.length} items`,
      contract: [
        `Campaign ${c.id}: ${c.goal}`,
        `You are fix lane ${owner} (${o.describe}). Fix as many of these ${items.length} problems as you can, most severe first:`,
        JSON.stringify(items.map(({ id, still, problem, severity, needs_reference }) => ({ id, still, problem, severity, needs_reference }))),
        o.brief ?? '',
        `The repo is read-only at ${REPO}. Your patch may touch only: ${o.scope.join(', ')}.`,
        `Start with: sh ${TOOL}/scripts/hc-patch.sh init ${REPO} ${o.scope.join(' ')}  (copies your scope to /work/edit). Edit there only.`,
        `When done: sh ${TOOL}/scripts/hc-patch.sh diff ${REPO} /out/patch.diff  (a git-style patch, repo-relative paths).`,
        `References: ${refsText(c).replace(/\n/g, ' ')}. Stills: ${ROUND}/stills/. Items marked needs_reference must cite the reference that settles them.`,
        'Write /out/report.json: {"owner", "items": [{"id", "status": "fixed|partial|not_fixed", "what", "evidence"}], "needs_human": [...]}.',
        'Binaries do not go in the patch: say in the report which builds the host must run (the campaign runs postApply).',
      ].filter(Boolean).join('\n'),
      inputs: [{ from: 'need' }],
      outputs: [{ name: 'patch', path: 'patch.diff' }, { name: 'report', path: 'report.json' }],
      verify: 'patch.diff only touches the owner scope; report.json lists every item',
      worker: { model: o.model ?? 'opus', tools: ['Read', 'Bash', 'Edit', 'Write', 'Glob', 'Grep'], toolchain: o.toolchain ?? [], timeoutSec: o.timeoutSec ?? 3600,
        binds: binds(c, n, { repo: true }), prompt: 'Work in /work, write outputs to /out. Follow the contract exactly.' },
      size: { work: 3, interface: 1 },
    });
  }
  atoms.push({
    id: 'compose', kind: 'compose', title: 'Check patch scopes and collect reports',
    contract: 'Confirm every patch only touches its owner scope and every report covers its items; write fix-summary.json.',
    inputs: atoms.map((a) => ({ from: a.id })),
    outputs: [{ name: 'summary', path: 'fix-summary.json' }],
    verify: 'fix-summary.json exists and has no scope violations',
    worker: { model: 'script', toolchain: ['node'], binds: binds(c, n), command: ['node', `${TOOL}/bin/hillclimb.mjs`, 'compose-fix', `${ROUND}/campaign.json`, '/in', '/out'] },
    size: { work: 1, interface: 1 },
  });
  return doc(c, n, 'fix', `Round ${n} fixes for ${c.id}: ${fixlist.items.length} problems across ${Object.keys(groups).length} lanes.`, atoms,
    'compose wrote fix-summary.json with no scope violations', "test -s /in/compose/fix-summary.json");
}

function doc(c, n, stage, text, atoms, statement, run) {
  return { schema: 'endoforge/atoms/1', need: { id: `HC-${c.id.toUpperCase()}-${roundName(n).toUpperCase()}-${stage.toUpperCase()}`, text },
    acceptance: [{ id: 'A1', statement, check: { kind: 'command', run } }], atoms };
}

/** Repo-relative paths a git patch touches (from its diff --git headers). */
export function patchPaths(diff) {
  const out = new Set();
  for (const m of diff.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)) { out.add(m[1]); out.add(m[2]); }
  return [...out];
}
export const inScope = (p, scope) => scope.some((s) => { const t = s.replace(/\/\*\*$/, '').replace(/\/$/, ''); return p === t || p.startsWith(t + '/'); });
