### Fixed
- Build filesystem paths from file URLs with `fileURLToPath` instead of `URL.pathname`,
  so the loop, pipeline and generator tests and the hillclimb campaign tool run from a
  checkout whose path holds a space.

### Added
- `make check` runs `tools/check_file_url_paths.py`, which fails on a `URL.pathname`
  used outside frozen experiments and names the `fileURLToPath` fix.
