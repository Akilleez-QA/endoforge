| Probe | Question | Result |
|---|---|---|
| [P-67](PRECOMMIT.md) | A capacity planner (`core/runtime/capacity/`, Mjölnir) that picks width, placement and split from the machine: the online tuner missed bars 1–4 on a loaded shared slice (199 against 422 accepted/s for width 16 in its worse round, because it yields to peers by design, plus a fixed bound-churn defect); 0 verdict changes; pinning cut cross-CCX fills 31–34× with no IPC gain. Ships with the best fixed arm as default, one pinned cohort per L3 domain at core width: 507 against 422 accepted/s | [RESULT.md](RESULT.md) |
