# Receipt template

> Reconstructed 2026-10-17. The original receipt template was not available; this version is
> rebuilt from Edition 3 (§2, §8, §9, §14, §18), the white paper (p. 20, evaluation receipt
> contract), the isolate-factory-lab receipt-set schema (`ifl-receipt-set-v1`) and the Field OS
> receipts. Content follows Edition 3 where the sources differ.

## Purpose

A receipt is the only thing that can make a number **Recorded** [E3 §2]. This template defines two parts: the **receipt set**, a directory of machine-written, content-addressed files that a verification command can check without trusting whoever produced it, and the **receipt document**, a short human-readable account in the style of the Field OS receipts that says what happened, what failed and what it does not establish. A receipt is evidence, not permission: a hash or a receipt does not authorize anything [E3 §17].

## 1. Receipt set layout

One directory per campaign: `receipts/<campaign-id>/`. Files marked *required* must exist for the set to verify. The layout follows the lab's working receipt sets (example: `~/Work/isolate-factory-lab/receipts/smoke-20261014T200656Z-99f032/`).

| File | Required | Written when | Content |
|---|---|---|---|
| `precommit.json` | required | Before the first measured job | Canonical JSON per `docs/templates/CAMPAIGN-PRECOMMIT.md`; includes `createdBeforeFirstMeasuredJob: true` |
| `precommit.sha256` | required | Immediately after `precommit.json`, before any unit starts | `<sha256>  precommit.json` |
| `environment-before.json` | required | Before the first block | Environment snapshot: host, CPU model and microcode, governor and frequency, SMT, kernel, memory, pressure, load, thermals, runtime versions, cgroup controllers; carries its own `sha256` |
| `environment-after.json` | required | After the last block | Same schema; differences are reported, not hidden |
| `calibration.json` (or embedded in the precommit) | required for `official` | Before the campaign | The calibration receipt at the measured commit, with its hash; an absent calibration is recorded as `status: absent` and makes the campaign uncalibrated |
| `samples.jsonl` | required | Streamed during the run | One line per attempt: campaign id, arm, role, mode, block, unit, index, candidate manifest ref, request (attempt id, `expectedContextRevision` = precommit hash), host-authored receipt, measurements, validation, guest output **as a digest and labelled `untrusted-nested`** |
| `lifetimes.jsonl` | required | At the end of each replicate lifetime | Unit identity, status, cleanup verification, counts (measured, oracle failures, parity failures, verified accepts, unique verified accepts, stages including `outcome_unknown`), per-stage CPU, time series |
| `blocks.jsonl` | required | At the end of each block | Quiet-gate result, sentinel benchmark, randomised order used, contamination measures |
| `cgroup-readbacks.jsonl` | required | At every window boundary | Raw `cpu.stat`, `memory.stat`, `memory.peak`, `pids` readbacks; host `/proc/stat` cross-check; descendant-in-cgroup assertion |
| `controls.json` | required | Before the first block | Empirical probes of the controls the campaign relies on (for example: network denial actually enforced, affinity enforced, quota throttling detectable, `io.stat` available or not) |
| `artifacts/<sha256>` | as needed | When produced | Content-addressed outputs (emitted code, diagnostics, large measurements); referenced from samples as `{sha256, sizeBytes}` |
| `summary.json` | required | After the run completes | Status, `precommitSha256`, claim state, drift, contradictions, inadmissible arms, per-arm results, paired comparisons, what was not measured |
| `summary.md` | required | With `summary.json` | Human-readable; contradictions and flags listed first; label (official, pilot, smoke) in the first line |
| `SHA256SUMS` | required | Last | `sha256sum` format over every other file in the set, artifacts included |

A partial set (driver killed, campaign interrupted) has no `summary.json` and no `SHA256SUMS`, and the verifier must refuse it. It is kept as evidence and never stitched into another campaign.

## 2. Verification

A verifier must check, without trusting the producer (items 1–5 are what the lab's `verify-receipts.mjs` checks today; item 6 is run by the lab's test suite and should move into the verifier):

1. every line of `SHA256SUMS` matches its file, and every file in the set is listed;
2. `sha256(precommit.json)` equals `precommit.sha256`, and `precommit.json` is canonical JSON;
3. `summary.json` and every sample's `expectedContextRevision` cite that hash;
4. every artifact's file name equals its content hash;
5. every file conforms to the receipt-set schema;
6. ledger rules: attempt ids unique; each lifetime slot recorded once; a failed lifetime records `outcome_unknown`; one campaign id; recorded unique-accept counts equal a recount from the samples [lab `tests/lib/ledger.mjs` L1–L5].

Commands:

```sh
# hash check alone
(cd receipts/<campaign-id> && sha256sum -c --quiet SHA256SUMS)

# full verification with the lab's verifier (working today)
node ~/Work/isolate-factory-lab/harness/verify-receipts.mjs receipts/<campaign-id>
# or, inside the lab:  make verify RECEIPTS=receipts/<campaign-id>
```

An Endoforge-native verifier is **Proposed** (R13 Stage 0). Until it exists, the lab's verifier is the reference. On 17 October 2026 it accepted the lab's smoke set: `ok: true`, 35 files, 205 lifetimes, 4,343 samples (R12 §4.2).

## 3. Receipt document

Every receipt set is accompanied by a short Markdown document, stored at `docs/receipts/<CAMPAIGN-ID>-RECEIPT.md` or beside the set. It follows the shape of the Field OS receipts (`FIELD-OS-MAIN-RIG-001-RECEIPT.md`, `FIELD-OS-WORKER-FABRIC-W1W2-20261008.md`, `FIELD-OS-WORKER-FABRIC-W3W4-20261008.md`).

```markdown
# <Campaign title> receipt

Date: <YYYY-MM-DD>. Kind: <official campaign | pilot (not a result) | smoke | documentation, not execution>.
Host: <name and class>. Receipt set: `receipts/<campaign-id>/`. Precommit SHA-256: `<hash>`.
Prediction id: `<id>`, committed before execution.

## Outcome
<One paragraph: passed / failed / inconclusive against the precommitted criterion, in those words.
Delivery state and outcome state stated separately.>

## Results
| <columns from the precommit's primary and secondary metrics> |
<Each value carries its label: Recorded, Derived (with the arithmetic), or Pilot (not a result).>

## Failed observations retained
<Every failed lane, refused gate, unknown outcome, inadmissible arm and environment flag.
Earlier failed attempts of the same campaign are listed and never overwritten.>

## Scope and what this does not establish
<Explicit list. At minimum: the population the sample represents; host and quiet-gate status;
whether calibration was valid; anything Edition 3 §14 lists that this result does not touch.>

## Identities
<Artifact, evaluator, workload, runtime and environment hashes; private raw roots; verification
command and its result.>

## Remaining gates
<What must happen next before a stronger claim can be made.>
```

## 4. Rules

- **Host-authored.** Timings and resource figures come from counters the candidate cannot touch; a guest's claim of success is untrusted nested data [E3 §9; W p.20].
- **Unknown is a state.** An attempt that may have executed but did not complete is `outcome_unknown`, never success or rejection [E3 §9].
- **Failed stays failed.** A failed campaign's receipt set is kept; a rerun is a new campaign with a new precommit.
- **No numbers without labels.** The summary may contain only Recorded values and Derived statistics; Upstream and Proposed values do not appear in a results table [lab `docs/LAB-DESIGN.md` rule 1].
- **Recorded is not rerun.** A later document citing the receipt says so, and says whether it re-verified the hashes.
- **Private data.** Raw roots that contain private inputs stay local; the receipt document names them and their hashes without copying their contents.

## Sources

- Edition 3 §2, §8, §9, §14, §17, §18; white paper p. 20 (build and evaluation receipt contracts).
- `~/Work/isolate-factory-lab/harness/lib/receipt-schema.mjs`, `harness/lib/receipts.mjs`, `harness/verify-receipts.mjs`, `tests/lib/ledger.mjs`, `docs/TESTING.md` (L6, L7), `receipts/smoke-20261014T200656Z-99f032/`.
- `~/Work/field-ops/docs/receipts/FIELD-OS-MAIN-RIG-001-RECEIPT.md`; `~/Work/field-ops-github-review/docs/receipts/FIELD-OS-WORKER-FABRIC-W1W2-20261008.md`, `FIELD-OS-WORKER-FABRIC-W3W4-20261008.md`, `FIELD-OS-WORKER-FABRIC-V1-DESIGN-RECEIPT.md`.
- R12, R13 (this library); `docs/templates/CAMPAIGN-PRECOMMIT.md`.
