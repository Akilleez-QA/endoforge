### Added
- `createLoopPool({ render: true })` warms the pinned Kitesurf engine in its own Worker inside each process loop
  cell, and `inspect({ html, viewport, expect })` runs the `count`, `text`, `attr`, `style`, `box`, `apart` and
  `page: noHorizontalOverflow` assertions, each reporting what it observed and what it needs. A fetch fails the
  check; each check starts from the memory image taken once after priming; a fault, exit, timeout or a
  handle left live at restore gives `outcome_unknown` and a replacement Worker. Off by default.
