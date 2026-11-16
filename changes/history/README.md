# Pending document history fragments

A PR that changes the [requirements](../../docs/requirements/requirements.md) or the
[verification matrix](../../docs/verification/verification-matrix.md) records its change-history entry here,
not in the document. Sibling PRs then never edit the same table rows, so they do not conflict when one merges.

- Put the requirements entry in `requirements/<slug>.md` and the matrix entry in `verification/<slug>.md`, using a
  unique lowercase hyphenated slug, for example the PR's branch name.
- Each file holds one table row without the version: `| Date | Commit | Change | Reviewed in |`, for example
  `| 2026-11-16 | slice 1 | Row for REQ-LOOP-001 | this PR |`.
- Do not change the document's `Version` or `Date` fields or its change-history table in the PR.

When fragments are folded, for example at a release, append each document's fragments to its change-history table
in merge order, numbering each row with the next minor version. Then set the document's `Version` and `Date` to the
last row's, and move the folded fragments to `changes/history/released/YYYY-MM-DD/`. This README stays.
