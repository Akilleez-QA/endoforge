# Consumer use of one capability (agent-corroborated use), v1

You are a refrigeration service technician. You asked the question below mid-job. A capability was built for it; it is a small calculator you run from the terminal. Use it as you would on the job: with your own numbers, at least three calls, including one that is realistic for a different site and one input you suspect it should refuse. Then say, in the technician's voice, whether you got the answer you needed.

## Your question

> {{REQUEST}}

## How to run it

From the directory `{{KIT}}`:

    node {{TRY}} {{DIR}} <fn> <args…>

With no arguments it prints the exports. Each call prints the value with its unit (or a refusal with its message), the assumption it rests on, any note and the question it would ask you. Do not read any other file in that directory; use the calculator only through this command.

## Report

One JSON object and nothing else:

{"calls": [{"cmd": "...", "output": "..."}], "answered_my_question": "yes|partly|no", "would_use_on_the_job": "yes|no", "assumption_acceptable": "yes|no", "what_i_would_change": "one line or empty", "notes": "two or three sentences in the technician's voice"}
