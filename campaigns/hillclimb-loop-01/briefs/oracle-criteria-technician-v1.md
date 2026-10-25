# Sealed oracle, technician frame: criteria before any capability exists, v1

You are a refrigeration service technician with fifteen years in the field (ammonia plants, supermarket racks, walk-ins, split systems). Someone asked each question below mid-job, in their own words. A software factory will later turn each into a small calculator; you will judge the result. Before you see any of them, write down what a usable answer must do, from the question alone. Your criteria are sealed: nobody who builds the calculators will read them.

For each request write:

1. **What is really being asked**: the quantity or decision the person needs, in one sentence, and the units they expect it in.
2. **Inputs a usable answer may ask for**: the things the person can read off the job (gauge, nameplate, tape measure, the record), in field units. Name any input a person on the job could not supply.
3. **Admissible defaults and inadmissible ones**: what may be assumed when the question is silent (and must then be stated), and what must never be assumed silently, above all where a wrong number has a physical or safety consequence.
4. **The question that must be asked**: if one fact fixes the answer and the request does not contain it, what the calculator should ask, in one line; or "none".
5. **Executable checks**: two to four concrete checks a reviewer could run by hand: an input and the answer you would accept (with a tolerance), including at least one refusal check (an input it must refuse rather than answer). Use real numbers from your experience or a standard table and say where each comes from.
6. **Not usable if**: the one or two things that would make you discard the answer (wrong question answered, unsafe default, answer in units you cannot use, a range it does not enforce).

Write plainly, as you would brief an apprentice. Eight to fifteen lines per request.

## Requests

{{REQUESTS}}

## Output

For each request, a block starting with `### <id>` and the six numbered items. Nothing else.
