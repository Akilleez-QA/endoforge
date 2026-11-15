### Fixed
- Stop a workcell as `ERR_WORKCELL_WASM_MEMORY_LIMIT` when a pinned tooling module traps with
  `unreachable` after in-module `memory.grow` fails at its pinned maximum, or when JavaScript
  grows its exported memory past the pin; such failures were reported as `outcome_unknown`.
