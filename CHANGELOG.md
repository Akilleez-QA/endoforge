# Changelog

Notable changes are recorded here using [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- X1 G1–G7 host port through the real thread/process evaluator, supervisor
  compiler and closed glue schema with local parity/refusal fixtures.

- Optional process-per-workcell isolation with fork/IPC, V8 heap limits, detected
  cgroup v2 limits and supervisor-written rejection receipts. P-18 records N=8
  heap/WASM breaches in both modes; process tests cover parity and ledger replay.

- Bounded V8 isolate workcells in `core/runtime/`, configurable worker heap limits,
  replacement after worker loss, and host-appended receipts using the existing
  ledger schema and hash chain. Core-count default sizing follows P-15/P-17.
  A separate 64 MiB default WASM linear-memory ceiling checks declarations and
  JS/internal growth, with explicit worker-local limit outcomes. `make isolate-test`
  covers evaluator parity, concurrency at 1/4/16, tampering, heap/WASM breaches
  during neighboring work, replacement, and shutdown.
- GPL-3.0-only license, contribution and conduct guidance, security policy,
  GitHub Actions CI, and secret-scanning configuration in
  [PR #1](https://github.com/Akilleez-QA/endoforge/pull/1).
- Repository layout planning through ADR 0001 and PATHMAP in
  [PR #4](https://github.com/Akilleez-QA/endoforge/pull/4).
  These were plans for later moves; neither planning file is in the current tree.

### Changed

- WASM compilation now rejects missing module memory maxima instead of supplying
  them; explicit limits and existing growth instrumentation remain enforced.

- Public-facing README rewrite in
  [PR #2](https://github.com/Akilleez-QA/endoforge/pull/2).
  The current README describes the lifecycle model, generic tools, and test commands.
- Commercial licensing contact added to the README in
  [PR #5](https://github.com/Akilleez-QA/endoforge/pull/5), without changing LICENSE.
  The current README includes that contact in its License section.

### Fixed

- Synthetic atomizer fan-out timing now disables host headroom throttling for
  that scheduler invocation. The fixture sleeps rather than consuming a core;
  inherited load and memory limits could serialize its independent workers on
  small runners despite concurrency 9. The >2x speedup and six-second wall
  assertions, receipt timing and rounding, and production throttling are
  unchanged. See the [verification matrix](docs/verification/verification-matrix.md)
  for two-core before/after measurements.
- Node 22 X1 test discovery by passing explicit test-file paths in
  [PR #3](https://github.com/Akilleez-QA/endoforge/pull/3).
  This is a historical fix; the current Makefile has no X1 test target.
