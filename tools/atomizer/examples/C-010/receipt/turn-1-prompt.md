You are the task atomizer of a software factory. Decompose the need below into the smallest units of work that can run in parallel, as one JSON document (schema "endoforge/atoms/1"). Output only the JSON: no prose, no code fences.

## What the factory makes from a technician's request
A capability: a pure AssemblyScript->WASM kernel (exported numeric functions over f64/i32/bool, no imports, deterministic), CONTRACT.md (what is computed, the assumption taken where the request left a fact open, the one question that resolves it, which inputs are refused), tests.json (executable tests in the fixed gate format: calls with expected values or expected traps), glue.json (labels, units, precision, codes, the assumption, the question, trap messages), then the fixed gates G1-G7 (frozen, compiles, exports, tests, deterministic, bounded, glue) and blind reviews by personas who judge from the request and the artefact's interface.

## Rules of atomization
1. An atom is the smallest unit that (a) has a contract verifiable from its declared inputs and outputs alone, (b) one worker finishes in one turn with bounded output (size.work <= 3 on a 1-5 scale), (c) fails alone. Split until (a)-(c) hold.
2. Stop splitting when the interface a split creates costs more than the work it saves: size.interface > size.work marks over-atomization. Keep the interface score honest.
3. Declare every input. An atom's isolate mounts only its declared inputs; anything undeclared does not exist for it. An input is {"from":"need"} or {"from":"<atomId>","output":"<outputName>"}.
4. Forbidden edges (enforced by the validator): tests -> kernel; kernel -> tests; kernel -> review; review -> kernel. The test writer and the kernel writer both work from the interface and the contract, never from each other.
5. Write the acceptance list from the need itself, before the atoms. Each item: {"id","statement","check"} with check {"kind":"command","run":"<shell using /in/compose/<file> paths>"} when it can be executed against the composed artefact, else {"kind":"oracle","criteria":"..."}.
6. Exactly one atom of kind "compose" gathers the parts into the artefact and runs the gates; its verify names the acceptance ids it satisfies.
7. Prefer wide waves: wave 0 = the interface stub (export names, argument names, units, codes, return types), the contract, and any data lookups, all independent; then per-export kernel atoms, per-family test atoms and per-export glue atoms in parallel; then compose; then reviews per persona in parallel, on different model families.
8. Workers: "sonnet" (default), "opus" (only where judgement is scarce), "codex" (a different model family; use it for at least one review), "script" (a deterministic command: "command" as an argv array using {in}, {out}, {work} placeholders, and "toolchain" from [node, asc, wasmtime]). A tool-less model worker ("tools": []) replies with exactly one file's content, so give it exactly one output. A worker that must compile or run tests needs "tools": ["Bash","Read","Write","Edit"] and a "toolchain".
9. Each atom: "id" (short, letters/digits/-/_), "kind" (interface|contract|tests|kernel|glue|data|compose|review|repair|other), "title", "contract" (precise, at least 20 characters, states what the output must satisfy), "inputs", "outputs" [{"name","path","describe"}], "verify" (how a script checks the output without a model), "worker" {"model","tools","toolchain" (optional),"prompt" (the worker's own instructions)}, "size" {"work","interface"}.
10. Kernel atoms must prefix every private helper or constant with the atom id so parts concatenate into one module; the scheduler appends a fixed procedure (formats, commands) to kernel, tests, glue, compose and review atoms, so do not restate formats in the worker prompts; say what, not how.
11. Do not invent facts about the equipment; where the request leaves a fact open, the contract atom records the assumption and the question, and the kernel implements the assumption.

## Fixed formats of the factory (reference real fields in acceptance commands)
- tests.json: a JSON array of {"name","fn","args":[numbers],"expect":number|boolean,"tol":number (absolute, for non-integers),"expectError":true (the call must refuse)}.
- glue.json (closed schema; no other top-level keys): {"id","assumption","question","notes" (optional),"exports":[{"name","label","args":[{"name","kind":"number|integer|boolean|code","unit","codes"|"labels"}],"result":{"kind","unit","precision"|"codes"|"labels"}}],"traps":[{"fn","when","message"}]}. Codes live inside the argument or result entries, never at the top level.
- gates.json (written by compose): {"promotable":boolean,"gates":{"G1_frozen":{"ok"},...,"G7_glue":{"ok"}},"tests":[{"name","fn","args","expect","got","pass"}]}; kernel.wasm has no imports; call exports through new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).
- compose outputs are fixed by the compose helper: kernel.wasm, kernel.wat, kernel.ts, CONTRACT.md, tests.json, glue.json, gates.json, failures.json, frozen.sha256; declare only these (one output per file, never a directory). Reviews read CONTRACT.md, glue.json, gates.json and tests.json, never kernel.ts.
- tests.json arguments: 1e999 for +Infinity, -1e999 for -Infinity, the string "NaN" for NaN; never null or bare words.
- A fixed repair stage is added by the scheduler after compose (draft compose -> one repair round that sees only the failing tests -> final compose); do not add repair atoms yourself.

## Output shape
{"schema":"endoforge/atoms/1","need":{"id":"C-010","text":"<the need, verbatim>"},"acceptance":[...],"atoms":[...]}

## The need (id C-010)

# Request C-010

| Field | Content |
|---|---|
| Collected | 2026-10-17, by the Endoforge mining agent and the refrigeration-ai session (candidate C-010, grade HIGH, source list: OWN-2 (corroborated by BACKLOG C-386 and DEC)) |
| Requester | author |
| Context | owner, 2026-10-17, demo data was showing future/unstable dates; day-based counts changed when a run crossed midnight UTC. |
| Inclusion rules met | 1 (owner vouched in chat on 2026-10-17: "Add all HIGH and MEDIUM candidates to the pool; I vouch for them") / 2 / 3 / 4 |

## The request, in the requester's words

> sample demo dates "must roll with the current day", with "now" anchored once per demo session. DECISIONS.md wording: "Sample data dates keep rolling with the current day; anchor 'now' once per demo session so counts stay stable during a run."

## Authoritative inputs the requester named

- the demo sample-data dates; the session clock.

## Examples the requester gave, if any

- none given; acceptance in C-386: "counts are stable across midnight UTC".

## What the collector did not ask

Nothing was clarified with the requester; the request is as found. Source: session file (owner row 2); BACKLOG C-386 note "Owner decision 2026-10-17T13:48:53"; DECISIONS.md "2026-10-17T13:48:53Z — demo target and sample dates"..
