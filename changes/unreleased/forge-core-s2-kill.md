### Added
- Propagate Forge Core isolate, warp and block kills through queued and running child jobs, with measured shutdown
  receipts and AbortSignal support for host adapters.
### Fixed
- Stop descendants on parent worker loss or deadline and await shutdown before returning parent outcomes.
