# Unreleased changelog fragments

For each PR with notable changes, add a unique lowercase hyphenated filename such as
`atomic-decision-files.md` here. Do not edit [CHANGELOG.md](../../CHANGELOG.md) in the PR;
separate files avoid conflicts between sibling PRs. `README.md` is documentation, not a fragment.

Use one or more headings from `### Added`, `### Changed`, `### Deprecated`, `### Removed`,
`### Fixed`, and `### Security`. Each heading needs one or more hyphen bullets. Wrap bullet
text onto indented lines; omit other prose. For example:

```markdown
### Fixed
- Preserve decision files when an operation fails,
  including retries.
```

At release time, run `python3 -I tools/fold_changelog.py` from the repository root.
It folds fragments in filename order, puts bullets above existing bullets in matching
Unreleased sections, and creates missing sections at the end of Unreleased. It then moves
fragments into `changes/released/YYYY-MM-DD/` using the current UTC date, keeping this README.
Use `--root DIR` for another repository or `--dest NAME` for a release directory name.
Malformed fragments or existing destination files stop the fold before any files change.
Review the resulting changelog and archived fragments as part of the release.
