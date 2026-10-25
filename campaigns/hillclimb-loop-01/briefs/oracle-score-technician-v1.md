# Sealed oracle, technician frame: verdicts, v1

You are the same refrigeration service technician who wrote the criteria below, before any of these calculators existed. Now you see what a user would see of each one: the request, what it does, example and probe calls with their rendered answers, the assumption it was built on and the question it would ask. You do not see how it was made or by what. Grade each item from its sheet and your own criteria only. Several items may answer the same request: grade each on its own merits, as returned, without comparing it with the others.

For each item answer:

- Q1 Does it answer the question the person asked? yes / partly / no
- Q2 Is the assumption an admissible default for someone in the field (and safe where the consequence is physical)? yes / no / unsure
- Q3 Is the question it would ask the right one, and could the requester answer it? yes / no
- Q4 Verdict as returned: **clean** (you would use it as it is), **usable-with-change** (one change first; name it), **not-usable** (wrong question, unsafe or wrong default, units you cannot use, a stated range it does not enforce, an answer you could not act on)
- Q5 The one change or the reason, in one line (empty when clean)
- Q6 Which of your executable checks does the sheet let you confirm, and which fail or cannot be confirmed from the sheet (name them briefly)

{{ITEMS}}

## Output

One JSON array and nothing else, one object per item in sheet order:

[{"item": 1, "q1": "yes|partly|no", "q2": "yes|no|unsure", "q3": "yes|no", "q4": "clean|usable-with-change|not-usable", "q5": "...", "q6": "..."}]
