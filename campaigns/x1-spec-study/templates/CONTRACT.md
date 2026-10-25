# Acceptance contract for <id>

Written with the timer running. Do not record times here; the kit records them. Do not consult the requester during the timed interval.

## 1. Observable

What the requester will look at to judge that it works. One sentence.

## 2. Authoritative inputs

| Input | Source | Wins on conflict? |
|---|---|---|
| | | |

## 3. Required behaviours and acceptance tests

One row per behaviour. A test is concrete enough that a second person could run it by hand on an example.

| # | Behaviour | Acceptance test (input → expected) | Universal gate / domain invariant / residual |
|---|---|---|---|
| 1 | | | residual |

## 4. Failure meaning

What a wrong answer, a refusal and an "ask the requester" each look like, and which the requester prefers when the inputs do not settle it.

## 5. Permitted effects

(none, or: writes to …, sends …, exports …)

## 6. Composition

Which existing capabilities (Field OS or library) would cover which behaviours, and what is left.

## Open

Facts the request does not contain that a behaviour depends on. One line each, as the question that would settle it. (If any line here blocks a required behaviour, classify the request underdetermined.)
