## Why

Describe the problem and link the related issue, if any.

## What

Describe the change and its effect on existing behavior.

## Verification

List exact commands and results, including failures or checks not run.
For code changes, run `make test` and `make test-optimized` from the root.
For documentation changes, run `make check`.
Use synthetic examples and redact private data from evidence.

## Requirements touched

List affected requirement IDs (`docs/requirements/requirements.md`) and confirm the verification matrix rows were
updated in this pull request, or explain why none apply. `make check` runs the trace check.

## Peer review record

- Reviewers and roles (human or agent; agent review is not independent):
- Findings raised and how each was resolved:
- Outcome (merged, changes requested, re-review):
- Documentation checklist, for documentation changes: the Cstack family checklist in the
  [Cstack standards folder](https://github.com/Akilleez-QA/cstack/tree/main/docs/standards).

## AI checklist

- [ ] I followed CONTRIBUTING.md and AGENTS.md.
- [ ] Claims are supported by the current tree and reproducible evidence.
- [ ] I did not weaken checks or edit expected results to make tests pass.
- [ ] I added no code comments, secrets, or private data.
- [ ] This pull request has one concern and fewer than 400 changed lines.
- [ ] AI-assisted commits include an `Assisted-by` trailer, or no AI was used.
