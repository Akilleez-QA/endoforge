import { readFile } from "node:fs/promises";
const [, , ...runs] = process.argv;
const median = v => { const s = [...v].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const arms = {};
for (const path of runs) {
  const [arm, dir] = path.split("=");
  const s = JSON.parse(await readFile(`${dir}/summary.json`, "utf8"));
  const totals = s.rows.map(r => r.timings.total);
  (arms[arm] ??= []).push({ dir, promoted: s.rows.filter(r => r.promoted).length, n: s.rows.length, p50: median(totals) / 1000, refused: s.rows.filter(r => !r.promoted).map(r => r.id).join(" ") });
}
console.log("| arm | run | promoted/30 | p50 total s | not promoted |\n|---|---|---|---|---|");
for (const [arm, list] of Object.entries(arms)) list.forEach((r, i) => console.log(`| ${arm} | ${i + 1} | ${r.promoted}/${r.n} | ${r.p50.toFixed(1)} | ${r.refused || "-"} |`));
console.log("\n| arm | mean promoted | min-max | mean p50 s | min-max |\n|---|---|---|---|---|");
for (const [arm, list] of Object.entries(arms)) { const p = list.map(r => r.promoted), t = list.map(r => r.p50); console.log(`| ${arm} | ${(p.reduce((a, b) => a + b) / p.length).toFixed(2)} | ${Math.min(...p)}-${Math.max(...p)} | ${(t.reduce((a, b) => a + b) / t.length).toFixed(1)} | ${Math.min(...t).toFixed(1)}-${Math.max(...t).toFixed(1)} |`); }
