### Changed
- A failed compile in the agent loop now returns the compiler's own
  diagnostics (code, line, column, message; at most five and 1 KiB) at
  G2, in the cell and on the external compiler.
- Check feedback reports only the first failing stage, lists failing
  tests in test order and marks a gate or test that passed in the
  previous round as a regression.
