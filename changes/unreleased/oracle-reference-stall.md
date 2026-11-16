### Fixed
- Run an oracle reference once more when its 50 ms sandbox times out, so one
  scheduling stall on a loaded runner no longer turns a correctable test into a
  specification problem and an extra specification turn.
