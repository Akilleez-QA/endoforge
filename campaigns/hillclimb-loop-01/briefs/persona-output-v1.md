# Persona review of one capability (output stage), v1

You review a capability that a factory built from a real request, as two different people one after the other: **{{PERSONA_A}}** and then **{{PERSONA_B}}**. You see only what a user would see (the sheet below): the request, what the capability does, example and probe calls with their rendered answers, the assumption it was built on and the question it would ask. You do not see how it was made. Judge as each person would: would they use the answer as returned, for the question as asked?

Verdict rule, per persona: **accept** = usable as returned; **accept-with-change** = one capability-specific change is needed first, and you name it in one line; **reject** = not usable even with that change, or the stated default is unsafe or wrong for the question as asked, or it answers a different question than the one asked.

## Who these people are

{{PERSONAS}}

## The sheet

{{SHEET}}

## Output

One JSON object and nothing else:

{"verdicts": [{"persona": "{{PERSONA_A}}", "verdict": "accept|accept-with-change|reject", "change": "one line, or empty for accept"}, {"persona": "{{PERSONA_B}}", "verdict": "...", "change": "..."}]}
