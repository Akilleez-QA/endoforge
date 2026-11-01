import fs from "node:fs";
const [N, base, out, flags] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5] ?? ""];
const cands = JSON.parse(fs.readFileSync(new URL("./worker/candidates.json", import.meta.url)));
const files = ["machinery/tools/engine/gates.mjs", "machinery/tools/factory_quality/index.mjs"];
const mods = [`(name = "workcell.js", esModule = embed "workcell.js")`, `(name = "candidates.json", json = embed "candidates.json")`, ...files.map((f) => `(name = "${f}", esModule = embed "${f}")`), ...cands.filter((c) => c.wasm).map((c) => `(name = "wasm/${c.wasm}", wasm = embed "wasm/${c.wasm}")`)].join(",\n    ");
const ids = Array.from({ length: N }, (_, i) => i);
const s = `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [ ${ids.map((i) => `(name = "w${i}", worker = (modules = [ ${mods} ], bindings = [ (name = "WID", text = "w${i}") ], compatibilityDate = "2026-09-01", compatibilityFlags = ["nodejs_compat"]))`).join(",\n")} ],
  sockets = [ ${ids.map((i) => `(name = "s${i}", address = "127.0.0.1:${base + i}", http = (), service = "w${i}")`).join(",\n")} ],
  v8Flags = [${flags ? flags.split(",").map((f) => `"${f}"`).join(", ") : ""}],
);
`;
fs.writeFileSync(out, s);
