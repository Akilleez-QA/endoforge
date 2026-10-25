# Interface stub for one request (challenger, stage 1), v1

You fix the interface of a capability that a factory will build from one real request: what it computes, the inputs it takes in the requester's own units, the one assumption it is built on, the one question that would settle that assumption, and the consequence tier. Other agents, who will not see each other's work, will write the acceptance tests and the code against this stub. Be concrete and small: the request is a few words from someone mid-job; the capability answers that question and nothing more.

## The request

Id: {{ID}}
Asked by: {{ROLE}}

> {{REQUEST}}

Authoritative inputs the requester named:
{{INPUTS}}

Examples the requester gave, if any:
{{EXAMPLES}}
{{RETRIEVED}}
{{FEEDBACK}}
## Rules

- One **headline** export that answers the request as asked, in the units the requester would use on the job (psig, F, lb, g, hp, m2 …). At most three further exports, only where the request needs them (an inverse, an alternative basis the question leaves open, a unit helper). Never a second export that answers the same quantity another way.
- Inputs: name, kind (`number`, `integer`, `boolean`, `code`), unit, a short label, and a `range` written as a leading bound or interval the kernel will enforce by refusing (`>= 0`, `> 0`, `-40..40`); advisory limits go in the label, not the range. `unit` is never empty: a field unit for numbers, `code` for a code argument, `flag` for a boolean, `dimensionless` or `count` when unitless. Every enumeration is a closed integer `codes` table with every accepted value labelled, and no `range` (the table is the range); code 0 is the default the assumption names.
- Result: kind, unit, `precision` (decimal places at field precision) for numbers; `codes` for codes; `labels` for booleans.
- `assumption`: one or two sentences naming the fact the request does not contain and the default you chose for it; it is printed with every answer. For a request whose wrong default has a physical consequence (a charge limit, a safety setpoint, a pressure or temperature someone will act on), choose the conservative default and say so.
- `question`: the one question the requester would be asked to settle the assumption, which they could answer from the nameplate, the gauge, the job or the record.
- `consequence`: `physical` when a wrong number could be acted on with a physical or safety consequence, else `informational`.
- `notes` (optional): a safety or presentation note printed with every answer (flammability, phase-out, "excludes tax").
- If no numeric kernel can serve the request at all, say so: one export that refuses, a `question` that names what is needed, and `serviceable: false`.

## Output

One JSON object and nothing else:

{"id": "{{ID}}", "serviceable": true, "consequence": "physical|informational", "assumption": "...", "question": "...", "notes": "...", "exports": [{"name": "camelCase", "label": "...", "headline": true, "args": [{"name": "...", "kind": "number", "unit": "...", "label": "...", "range": ">= 0", "codes": {"0": "..."}}], "result": {"kind": "number", "unit": "...", "precision": 1}}]}
