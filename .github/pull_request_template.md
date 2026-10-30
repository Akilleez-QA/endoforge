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

Identify affected requirements or contracts, or explain why none apply.

## AI checklist

- [ ] I followed CONTRIBUTING.md and AGENTS.md.
- [ ] Claims are supported by the current tree and reproducible evidence.
- [ ] I did not weaken checks or edit expected results to make tests pass.
- [ ] I added no code comments, secrets, or private data.
- [ ] This pull request has one concern and fewer than 400 changed lines.
- [ ] AI-assisted commits include an `Assisted-by` trailer, or no AI was used.
