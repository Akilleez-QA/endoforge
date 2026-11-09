# Getting started

This tutorial takes a fresh clone to a first promoted candidate. It runs the real candidate loop (freeze, compile,
gates, ledger and promotion decision) with a scripted model, so it needs no model account and makes no network call
after setup. It takes about five minutes.

Every command below was run on a fresh clone of `main` on Linux with Node.js 26.13.0 and Python 3.

## 1. Install the prerequisites

You need:

- Git, GNU Make and Python 3.11 or later.
- Node.js 22.8 or later. CI runs Node 22 and Node 26.
- bubblewrap (`bwrap`), `age` and `gcc` for the full test suite. This tutorial does not need them.

## 2. Clone and run the repository checks

```sh
git clone https://github.com/Akilleez-QA/endoforge.git
cd endoforge
make check
```

`make check` takes about a second. It checks Markdown links, the experiments index, source digests, experiment
number allocation, the privacy lint (`0 failure(s) over N records`), requirement traceability (a JSON summary with
`"problems": 0`) and the data dictionary. The last line reads `data dictionary current`.

## 3. Run a few test targets

```sh
make core-test engine-test library-test
```

`core-test` runs the Python lifecycle and boundary tests (`Ran 71 tests ... OK`). `engine-test` runs the evaluator and
gate tests (`pass 19`, `fail 0`). `library-test` runs the kernel library tests. Together they take about 20 seconds.

## 4. Install the pinned compiler

The candidate loop compiles AssemblyScript inside a workcell with a pinned compiler:

```sh
make loop-setup
```

This runs `npm ci` in `tools/asc` and needs network access once.

## 5. Run the candidate loop with a scripted model

Save this as `first-loop.mjs` in the repository root:

```js
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLoopPool } from './core/runtime/x1/loop.mjs';
import { runNeed } from './core/runtime/x1/pipeline.mjs';
import { scriptedProvider } from './core/runtime/x1/transports.mjs';
import { candidate } from './core/runtime/test/fixtures/x1/candidate.mjs';
import { inputFor, modelFor } from './core/runtime/test/fixtures/x1/scripted-model.mjs';
import { good, seeds } from './core/runtime/test/fixtures/x1/seeds.mjs';

const kernel = process.argv[2] === 'wrong' ? seeds[1] : good;
const { files } = candidate();
const script = modelFor(inputFor(files['CONTRACT.md'], files['tests.json'], kernel.kernel, kernel.glue));
const pool = createLoopPool({ provider: scriptedProvider(script) });
const directory = join(mkdtempSync(join(tmpdir(), 'ef-first-loop-')), 'addition');
try {
  const result = await runNeed({ need: 'integer add(a,b)', directory, pool, env: { ENDOFORGE_LOOP: 'agent' } });
  console.log(JSON.stringify({
    promoted: result.promoted,
    testDouble: result.testDouble,
    turns: result.agent?.turns,
    exit: result.agent?.exit_reason,
    rounds: result.rounds?.map(round => round.failures ? Object.keys(round.failures.gates) : "passed"),
    ledger: join(directory, 'ledger.sqlite'),
  }, null, 2));
} finally {
  await pool.close();
}
```

Run it:

```sh
node first-loop.mjs
```

The output looks like this (the temporary path differs):

```json
{
  "promoted": true,
  "testDouble": true,
  "turns": 2,
  "exit": "stop",
  "rounds": [
    "passed"
  ],
  "ledger": "/tmp/ef-first-loop-LQUkB6/addition/ledger.sqlite"
}
```

What happened:

1. `ENDOFORGE_LOOP=agent` selected the agent loop inside the workcell. See the
   [candidate loop](../../architecture/candidate-loop.md) for the three loop paths.
2. The scripted model wrote `CONTRACT.md` and `tests.json` in its first turn. The host froze them into the ledger.
3. In its second turn it wrote `kernel.ts` and `glue.json`. The cell compiled the kernel with the pinned compiler and
   ran gates G1 to G9.
4. All gates passed, so the host committed the candidate, its receipt and a promotion decision in one transaction.
5. `testDouble: true` says a test double wrote the code. A scripted run is never evidence of model quality.

## 6. Look at the ledger

The ledger is the only durable output. Print its record kinds, using the path from the output above:

```sh
python3 -c 'import sys; from core.ledger.ledger import Ledger; print([r["kind"] for r in Ledger(sys.argv[1]).records()])' /tmp/ef-first-loop-LQUkB6/addition/ledger.sqlite
```

```text
['task', 'admitted_input', 'frozen_evaluator', 'candidate', 'receipt']
```

The records are hash-chained. The [ledger ICD](../../interfaces/ledger-icd.md) describes each kind.

## 7. Watch a candidate fail

Run the same script with a kernel that subtracts instead of adding:

```sh
node first-loop.mjs wrong
```

```json
{
  "promoted": false,
  "testDouble": true,
  "turns": 7,
  "exit": "max_turns",
  "rounds": [
    [
      "G4_tests"
    ],
    ...
  ],
  ...
}
```

Each round failed `G4_tests`, and each failure went back to the model as its next prompt. The scripted model never
fixes the kernel, so the loop stopped at the turn limit (`limits.maxTurns`, default 6 for the implementation stage,
after one specification turn). Nothing was promoted.

## Next steps

- Run the full suite: [run local checks](../how-to/local-checks.md).
- Read how the loop works: [candidate loop](../../architecture/candidate-loop.md).
- Look up a setting: [configuration reference](../../configuration/configuration-reference.md).
- Use a real model: the agent loop takes a provider such as `WarmClaudeTransport`. Real calls go through the
  subscription guard and the usage governor; see [runtime](../../../core/runtime/README.md#the-agent-loop-in-the-workcell).

Delete `first-loop.mjs` when you are done; it is not part of the repository.
