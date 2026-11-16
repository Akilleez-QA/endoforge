### Fixed
- Wait for the dump-list trailing write's counter, not its file, in
  the rate-limit test, so a loaded CI runner no longer fails it.
