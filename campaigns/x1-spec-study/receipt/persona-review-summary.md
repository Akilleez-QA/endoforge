# Persona review of the promoted X1 capabilities: summary receipt (2026-10-17)

Scope: the 19 capabilities promoted by the dark-factory run listed in `work/factory/INDEX.md` (CC-001, rejected, not reviewed). Method: house persona-review method; 2–3 personas per capability chosen by who would make the request. Each capability's kernel was run on the usage-line example plus at least two persona-realistic inputs including one edge case. Full report, kernel-call log and proposed backlog live under `work/persona-review/` (git-ignored, may hold request text). This receipt holds ids and counts only. Nothing under `work/factory/`, the kit or the gates was modified.

Verdict rule: accept = usable as returned once the cross-cutting presentation fixes land; accept-with-change (AwC) = one capability-specific change named; reject = not usable even with that change, or the stated default is unsafe for the question asked.

| id | personas consulted | verdicts |
|---|---|---|
| C-005 | technician, field-service-contractor | AwC, AwC |
| C-006 | technician, field-service-contractor | reject, AwC |
| C-007 | technician, field-service-contractor | AwC, AwC |
| C-010 | plant-manager, supervisor, new-admin | AwC, accept, AwC |
| C-012 | plant-manager, new-admin | accept, AwC |
| C-015 | psm-coordinator, plant-manager, new-admin | AwC, accept, AwC |
| C-016 | psm-coordinator, plant-manager, supervisor | AwC, AwC, accept |
| C-019 | operator, psm-coordinator | AwC, AwC |
| CC-002 | technician, field-service-contractor | AwC, accept |
| CC-007 | technician, field-service-contractor | AwC, accept |
| CC-009 | psm-coordinator, field-service-contractor | AwC, AwC |
| CC-011 | technician, field-service-contractor | reject, AwC |
| CC-013 | technician, field-service-contractor | AwC, accept |
| CC-014 | technician, field-service-contractor | accept, accept |
| CC-022 | technician, field-service-contractor | AwC, accept |
| CC-025 | technician, field-service-contractor | accept, accept |
| CC-026 | technician, field-service-contractor | AwC, AwC |
| CC-027 | technician, field-service-contractor | AwC, AwC |
| CC-036 | technician, field-service-contractor | accept, accept |

Totals: 19 capabilities, 43 persona verdicts: 14 accept, 27 accept-with-change, 2 reject. Capabilities accepted outright by every persona consulted: 3 (CC-014, CC-025, CC-036). Capabilities with one persona rejection: 2 (C-006, CC-011). Kernel calls run: 155 (25 trapped as expected on invalid or unanswerable input; 1 returned a value outside its stated fit range).

Proposed backlog: 21 items in `work/persona-review/proposed-backlog.json` (area `x1-capabilities`, owner `factory`). Top five by priority and personas hit:

1. Trap codes need a message: every refusal says why and what to supply
2. Print the assumption with every answer
3. Round every answer to field precision and print its unit
4. Print the label with every boolean and integer code
5. One kernel per quantity: merge CC-002/CC-013 (dew point), CC-025/CC-036 (kW to hp), C-007/CC-027 (subcooling band)

## Re-run review (2026-10-17, later the same day)

C-006 and CC-011 were rebuilt by fresh workers under the extended protocol (glue + G7; see `receipt/notes.md`) with the findings above handed as input, then reviewed by a fresh persona agent blind to this report and to the workers' reasoning (technician and field-service-contractor; 15 kernel calls each; report `work/persona-review/rerun-REPORT.md`, git-ignored).

| id | personas consulted | verdicts | promotion status |
|---|---|---|---|
| C-006 (v2) | technician, field-service-contractor | AwC, accept | promoted-pending-change |
| CC-011 (v2) | technician, field-service-contractor | reject, accept | gated-rejected-by-persona |

Correction: the per-capability table above sums to 41 verdicts (14 accept, 25 accept-with-change, 2 reject); the totals line's 43 (14/27/2) was an arithmetic slip in the report. With the re-run, the 19 gated capabilities carry 41 current verdicts: 16 accept, 24 accept-with-change, 1 reject. `factory/promote.mjs` now applies these: promoted = gated and no persona reject; see `work/factory/INDEX.md`.
