### Fixed
- G8 classifies NaN, `Infinity` and `-Infinity` separately from what the contract
  names and probes only the stated kinds, so a contract that traps only on NaN no
  longer demands an infinity trap; NaN wording with `rejected` or `NaNs` reads as a trap.
