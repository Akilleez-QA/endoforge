# Changelog

Notable changes are recorded here using [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- GPL-3.0-only license, contribution and conduct guidance, security policy,
  GitHub Actions CI, and secret-scanning configuration in
  [PR #1](https://github.com/Akilleez-QA/endoforge/pull/1).
- Repository layout planning through ADR 0001 and PATHMAP in
  [PR #4](https://github.com/Akilleez-QA/endoforge/pull/4).
  These were plans for later moves; neither planning file is in the current tree.

### Changed

- Public-facing README rewrite in
  [PR #2](https://github.com/Akilleez-QA/endoforge/pull/2).
  The current README describes the lifecycle model, generic tools, and test commands.
- Commercial licensing contact added to the README in
  [PR #5](https://github.com/Akilleez-QA/endoforge/pull/5), without changing LICENSE.
  The current README includes that contact in its License section.

### Fixed

- Node 22 X1 test discovery by passing explicit test-file paths in
  [PR #3](https://github.com/Akilleez-QA/endoforge/pull/3).
  This is a historical fix; the current Makefile has no X1 test target.
