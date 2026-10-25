# Persona check at contract time (challenger, stage 2), v1

Before any code is written, you judge the proposed interface of a capability as the person who asked would: **{{PERSONA_A}}**, then **{{PERSONA_B}}**. You see the request and the stub (what it will compute, its inputs and units, the assumption, the question, the consequence tier). Nothing has been built yet, so a change costs nothing now and a lot later.

Judge: Does the headline answer the question actually asked, in units this person uses? Is the assumption an admissible default for someone in the field, and safe where a wrong number has a physical consequence? Is the question the right one to ask, and could the requester answer it? Is anything missing that this person would need before using the number, or present that they would never use?

## Who these people are

{{PERSONAS}}

## The request

Id: {{ID}}
Asked by: {{ROLE}}

> {{REQUEST}}

## The proposed stub

{{STUB}}

## Output

One JSON object and nothing else. `verdict` is `accept` when both personas would build against this stub as it stands, else `revise`; `change` names the one change (the most important, one or two sentences) the stub must take before the tests and the code are written.

{"verdicts": [{"persona": "{{PERSONA_A}}", "verdict": "accept|revise", "change": "..."}, {"persona": "{{PERSONA_B}}", "verdict": "accept|revise", "change": "..."}], "verdict": "accept|revise", "change": "..."}
