### Fixed
- Make the ledger writer and the decision and constraint stores sync
  through one helper that picks F_FULLFSYNC, fdatasync or fsync for
  the platform, so the ledger runs on macOS and stays durable there;
  `make check` refuses raw syncs outside the helper.
