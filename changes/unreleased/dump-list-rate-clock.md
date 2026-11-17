### Fixed
- Hold the dump-list rate-limit test's clock still while it refreshes, so a
  slow fsync or a stalled CI runner no longer opens the window early and fails
  it with more than one write.
