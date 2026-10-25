# P-13 attempt 04 — distinct empty npm configuration files

**Proposed before attempt 04, 18 October 2026.** Attempt 03 stopped before downloading dependencies because npm rejects using the same file (`/dev/null`) for both user and global configuration. Use two distinct newly created empty files instead. Preserve the failed setup and exact runner. Fix the error formatter to use captured stderr rather than the subprocess pipe object. No acceptance, dependency, runtime, resource or workload change; all amendment-03 controls remain in force.
