// Deterministic overlay generator (seed 20261017). Exports makeProject(n, errors) -> { root, files }
// where files maps absolute paths (under root) to text. Each module has an interface, a class, a few
// functions, and imports 2–3 earlier modules; `errors` names the module indices that get one
// deliberate type error each.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export function makeProject(n, errorAt, root = "/proj") {
  const r = rng(20261017 + n);
  const files = {};
  const name = (i) => `m${String(i).padStart(2, "0")}`;
  for (let i = 0; i < n; i++) {
    const deps = [];
    const k = i === 0 ? 0 : Math.min(i, 2 + (r() < 0.5 ? 1 : 0));
    while (deps.length < k) {
      const d = Math.floor(r() * i);
      if (!deps.includes(d)) deps.push(d);
    }
    const L = [];
    for (const d of deps) L.push(`import { ${name(d).toUpperCase()}Record, make${name(d)}, sum${name(d)} } from "./${name(d)}";`);
    const N = name(i).toUpperCase();
    L.push(``, `export interface ${N}Record {`, `  id: number;`, `  label: string;`, `  tags: readonly string[];`, `  weight: number;`, `  nested: { depth: number; ok: boolean };`, `}`, ``);
    L.push(`export type ${N}Key = keyof ${N}Record;`, ``);
    L.push(`export class ${N}Store {`, `  private items = new Map<number, ${N}Record>();`, `  add(rec: ${N}Record): this {`, `    this.items.set(rec.id, rec);`, `    return this;`, `  }`,
      `  get(id: number): ${N}Record | undefined {`, `    return this.items.get(id);`, `  }`,
      `  pick<K extends ${N}Key>(key: K): Array<${N}Record[K]> {`, `    return [...this.items.values()].map((x) => x[key]);`, `  }`,
      `  total(): number {`, `    let t = 0;`, `    for (const x of this.items.values()) t += x.weight;`, `    return t;`, `  }`, `}`, ``);
    L.push(`export function make${name(i)}(id: number, label: string, weight = ${i + 1}): ${N}Record {`,
      `  return { id, label, tags: [label, "${name(i)}"], weight, nested: { depth: ${i % 7}, ok: weight > 0 } };`, `}`, ``);
    L.push(`export function sum${name(i)}(xs: readonly ${N}Record[]): number {`, `  return xs.reduce((a, x) => a + x.weight * (x.nested.ok ? 1 : 0), 0);`, `}`, ``);
    // Cross-module use.
    for (const d of deps) {
      const D = name(d).toUpperCase();
      L.push(`export function bridge${name(d)}To${name(i)}(src: ${D}Record): ${N}Record {`,
        `  const base = make${name(i)}(src.id * 2, src.label.toUpperCase());`,
        `  return { ...base, weight: base.weight + sum${name(d)}([src, make${name(d)}(1, "x")]) };`, `}`, ``);
    }
    // Filler: a discriminated union and a narrowing switch (adds realistic checker work).
    L.push(`type ${N}Event = { kind: "add"; rec: ${N}Record } | { kind: "del"; id: number } | { kind: "clear" };`,
      `export function apply${name(i)}(store: ${N}Store, ev: ${N}Event): string {`, `  switch (ev.kind) {`,
      `    case "add": store.add(ev.rec); return "added " + ev.rec.label;`,
      `    case "del": return store.get(ev.id) ? "deleted" : "missing";`,
      `    case "clear": return "cleared";`, `  }`, `}`, ``);
    const extra = 1 + Math.floor(r() * 4);
    for (let e = 0; e < extra; e++) {
      L.push(`export const ${name(i)}Const${e}: Readonly<Record<string, number>> = { a: ${e}, b: ${e * 2}, c: ${i} };`,
        `export function ${name(i)}Fn${e}(v: ${N}Record, f: number = ${e}): [string, number] {`,
        `  const picked = [v.label, String(v.id)].join("-");`, `  return [picked, v.weight * f + ${name(i)}Const${e}.c];`, `}`);
    }
    if (errorAt.includes(i)) {
      L.push(``, `// deliberate type error`, `export const broken${name(i)}: number = make${name(i)}(1, "oops").label;`);
    }
    L.push(``);
    files[`${root}/src/${name(i)}.ts`] = L.join("\n");
  }
  files[`${root}/tsconfig.json`] = JSON.stringify({
    compilerOptions: { strict: true, target: "es2022", module: "esnext", moduleResolution: "bundler", lib: ["es2022"], types: [], noEmit: true, skipLibCheck: true, incremental: false },
    include: ["src/**/*.ts"],
  }, null, 2);
  return { root, files };
}

export const PROJECTS = {
  five: () => makeProject(5, [3]),
  fifty: () => makeProject(50, [7, 19, 23, 38, 49]),
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const p = PROJECTS[process.argv[2] ?? "fifty"]();
  const texts = Object.values(p.files);
  console.log(JSON.stringify({ files: texts.length, bytes: texts.reduce((a, t) => a + t.length, 0), lines: texts.map((t) => t.split("\n").length) }));
}
