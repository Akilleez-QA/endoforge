# Codex workers

Set `ENDOFORGE_WORKER=codex` (or policy `workerBackend: "codex"`) to convert
model atoms; script atoms stay scripts. Native is the default. Codex concurrency
is `ENDOFORGE_CODEX_CONCURRENCY` (default 3); `--concurrency` takes precedence.

Launch chain: `schedule.mjs → codex-pool (host) → guard (host) → bin/isolate-exec.mjs (host) → bwrap isolate → codex`.
`ENDOFORGE_CODEX_POOL` overrides `/home/box/.local/bin/codex-pool`.
Accounts, balancing, cooldown, failover and guard execution belong to codex-pool;
see [/workspace/ops/playbooks/codex-workers.md](/workspace/ops/playbooks/codex-workers.md).
Add an account with `CODEX_HOME=~/.codex-accounts/<name> codex login`.
`CODEX_POOL_PER_ACCOUNT` defaults to 2. The selected account directory is mounted
as CODEX_HOME; the atomizer never reads or copies its credentials. Tool workers
use bwrap as their sandbox; tool-less output has Markdown fences removed.

`routing.json` defines:

| Tier | Model | Effort |
| --- | --- | --- |
| light | gpt-6.1-sol | low |
| standard | gpt-6.1-sol | medium |
| deep | gpt-6-astra | high |
| deep fallback | gpt-6.1-sol | high |
| throwaway | gpt-6-luna | low |

Throwaway requires an explicit tier override; output is scratch, never committed.
Retries escalate light → standard → deep. Account failover keeps the tier.
A deep model rejection gets one fallback launch within the same attempt.
Pool exit 75 and guard exit 77 stop retries.

Each launch logs atom, attempt, tier/reason, model, effort, last account and
failovers. Attempt receipts and ledger events include these fields, ordered
account names and modelFallback. `receipt/run.json` and the final stderr summary
include successful attempts per account as `codexAccounts` (the primary account
is named `default` by the pool). `fanout.mjs` runs separate schedulers: the global
concurrency cap is per scheduler; account caps are shared through codex-pool state.
