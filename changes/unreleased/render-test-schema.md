### Added
- Frozen render tests: `tests.json` can hold closed-form render tests with reducer steps,
  G3 requires the reducers a render test steps through, the freeze and G7 check
  the view's `text/html` media and the reducer layouts, and a
  kernel with render tests is never promotable until the render gate exists.
