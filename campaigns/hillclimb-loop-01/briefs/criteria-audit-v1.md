# Audit of oracle criteria for executable anchoring, v1

Below are criteria sheets that three sealed reviewers wrote for real technician requests before any calculator existed. Your job is narrow: for each sheet, judge whether its **executable checks** (item 5) are anchored well enough that a second person could run them by hand and agree on pass or fail. Do not judge whether the criteria are right about refrigeration; judge whether they are checkable.

Score each sheet 0, 1 or 2:
- **2**: every check names a concrete input, an expected answer or behaviour, a tolerance where a number is expected, and a source; a stranger could run them.
- **1**: at least one check is concrete, but some are vague (no number, no tolerance, "should be reasonable"), or sources are missing.
- **0**: no check could be run by hand as written.

For each sheet, also name the single most useful fix in one line.

{{SHEETS}}

## Output

One JSON array and nothing else: [{"sheet": "<label>", "score": 0|1|2, "checks_total": n, "checks_runnable": n, "fix": "..."}]
