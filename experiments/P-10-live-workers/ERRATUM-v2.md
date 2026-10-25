# P-10 pre-measurement mount correction

Recorded (probe): original attempt `20261018T190029Z-d0daac7e` stopped at the first model launch, before model execution: the private-home bind overlaid the earlier CLI install mounts, causing bubblewrap `execvp` ENOENT. All prior shell boundary checks passed. No model output or usage exists from that attempt.

Proposed correction before new measurement: bind the minimal home BEFORE binding the allowed read-only CLI installation paths underneath that home. Freeze changed runner under `precommit-v2.json` and retain original canonical precommit and failed receipt untouched. Acceptance rules/request/oracle unchanged. The second attempt is distinct evidence.
