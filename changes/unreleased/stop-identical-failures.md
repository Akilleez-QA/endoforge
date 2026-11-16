### Changed
- The agent loop's implementation stage now ends with `repeated_failure` when two consecutive checks fail
  the same tests with the same values, instead of spending its remaining turns; the receipt names the tests
  and the decision is `refuse`.
