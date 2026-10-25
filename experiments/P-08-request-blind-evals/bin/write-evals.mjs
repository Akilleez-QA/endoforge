// Write the 12 new suites (OLD-Codex replay x4, NEW-Sonnet x4, NEW-Codex x4) in parallel; OLD-Sonnet suites are the recorded loop-1 tests.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process';
const ROOT = '/home/user/Work/endoforge'; const L1 = `${ROOT}/campaigns/hillclimb-loop-01/work`;
const IDS = ['C-003', 'CC-020', 'C-022', 'CC-029'];
const policy = JSON.parse(fs.readFileSync(`${ROOT}/tools/atomizer/policy.json`, 'utf8'));
const brief = fs.readFileSync('briefs/evals-request-only-v1.md', 'utf8');
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'p08-empty-'));
const env = { ...process.env }; delete env.CLAUDE_EFFORT; delete env.ANTHROPIC_API_KEY;
const run = (cmd, args, stdin) => new Promise((res) => { const t0 = Date.now(); const p = spawn(cmd, args, { cwd: empty, env, stdio: ['pipe', 'pipe', 'pipe'] }); let o = '', e = ''; p.stdout.on('data', (d) => { o += d; }); p.stderr.on('data', (d) => { e += d; }); p.on('close', (code) => res({ code, out: o, err: e, wallMs: Date.now() - t0 })); if (stdin) p.stdin.write(stdin); p.stdin.end(); });
const claude = async (prompt) => { const r = await run('claude', ['-p', ...policy.claudeLeanFlags, '--model', policy.models.sonnet, '--tools', '', '--effort', 'low'], prompt); let d = {}; try { d = JSON.parse(r.out); } catch {} return { text: d.result ?? '', usage: d.usage ?? null, wallMs: r.wallMs, code: r.code }; };
const codex = async (prompt, tag) => { const o = path.join(empty, `${tag}.txt`); const r = await run('codex', ['exec', '-s', 'read-only', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '-m', 'gpt-6.1-sol', '-c', 'tools.web_search=false', '--json', '-o', o, prompt]); let usage = null; for (const l of r.out.split('\n')) { try { const e = JSON.parse(l); if (e.type === 'turn.completed') usage = e.usage; } catch {} } return { text: fs.existsSync(o) ? fs.readFileSync(o, 'utf8') : '', usage, wallMs: r.wallMs, code: r.code }; };
const sig = (id) => { const s = JSON.parse(fs.readFileSync(`${L1}/runs/s5/B-Snew-Gnew-${id}/${id}/stub.json`, 'utf8')); return s.exports.map((e) => `${e.name}(${e.args.map((a) => `${a.name} [${a.unit}]`).join(', ')}) -> [${e.result.unit}]`).join('\n'); };
const request = (id) => fs.readFileSync(`${ROOT}/campaigns/x1-spec-study/work/pool/${id}.md`, 'utf8').replace(/## What the collector did not ask[\s\S]*$/, '').trim();
const oldPrompt = (id) => { const f = fs.readdirSync(`${L1}/calls`).find((n) => n.startsWith(`s5-S-new-${id}-1-evaluator-`) && n.endsWith('.prompt.md')); return fs.readFileSync(`${L1}/calls/${f}`, 'utf8'); };
fs.mkdirSync('receipt/suites', { recursive: true });
const jobs = [];
for (const id of IDS) {
  const np = brief.replace('{{REQUEST}}', request(id)).replace('{{SIGNATURE}}', sig(id));
  fs.writeFileSync(`receipt/suites/${id}.new.prompt.md`, np);
  jobs.push(['NEW-sonnet', id, () => claude(np)]);
  jobs.push(['NEW-codex', id, () => codex(np, `${id}-new`)]);
  jobs.push(['OLD-codex', id, () => codex(oldPrompt(id), `${id}-old`)]);
  fs.copyFileSync(`${L1}/runs/s5/B-Snew-Gnew-${id}/${id}/tests.json`, `receipt/suites/${id}.OLD-sonnet.tests.json`);
}
const results = await Promise.all(jobs.map(async ([arm, id, f]) => { const r = await f(); fs.writeFileSync(`receipt/suites/${id}.${arm}.raw.txt`, r.text); return { arm, id, wallMs: r.wallMs, code: r.code, usage: r.usage, chars: r.text.length }; }));
fs.writeFileSync('receipt/writing.json', JSON.stringify(results, null, 1));
for (const r of results) console.log(r.id, r.arm, r.code, `${(r.wallMs / 1000).toFixed(0)} s`, r.chars, JSON.stringify(r.usage ?? {}).slice(0, 120));
