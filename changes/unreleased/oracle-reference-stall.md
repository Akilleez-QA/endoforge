### Fixed
- Run an oracle reference once more when its 50 ms sandbox times out, so one
  scheduling stall on a loaded runner no longer turns a correctable test into a
  specification problem and an extra specification turn.
- The oracle no longer reads a thrown value, a global accessor or an inherited
  property of a reference outside its deadline, so a hostile `reference.js` gets a
  trap or no reference instead of hanging the loop cell until its job timeout.
