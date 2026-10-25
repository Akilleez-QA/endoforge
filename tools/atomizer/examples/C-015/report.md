# Atomization of C-015

Model sonnet; attempts 1; valid: true. Prompt sha256 fc90425fff3edb1b…

Atoms 12; total work 20; critical path 9 (contract → kernel-decision → compose → review-codex); speedup bound 2.22x; widest wave 7.

| Wave | Atoms |
|---|---|
| 0 | iface (interface, sonnet, w1/i1); contract (contract, sonnet, w2/i1) |
| 1 | kernel-decision (kernel, sonnet+tools, w2/i1); kernel-allowed (kernel, sonnet+tools, w2/i1); tests-decision (tests, sonnet, w2/i1); tests-allowed (tests, sonnet, w1/i1); tests-traps (tests, sonnet, w1/i1); glue-decision (glue, sonnet, w1/i1); glue-allowed (glue, sonnet, w1/i1) |
| 2 | compose (compose, sonnet+tools, w3/i2) |
| 3 | review-codex (review, codex, w2/i2); review-tech (review, sonnet, w2/i2) |

## Acceptance (from the need)

- A1: The kernel exports approvalDecision and approvalAllowed. [command]
- A2: CONTRACT.md records the assumption taken, the one open question, and the refused inputs. [command]
- A3: A person with the role right but no recorded qualification for the action is never allowed, for both waivers and MOC approvals. [oracle]
- A4: A person with a qualification but without the role right is never allowed (the qualification does not replace the role right). [oracle]
- A5: Approval is allowed only when both the role right and a recorded, unexpired qualification for that specific action are present. [oracle]
- A6: Malformed inputs (unknown action type, non 0/1 role flag, negative mask, non-finite days) trap rather than return a decision. [oracle]
- A7: glue.json carries labels, units, codes, the assumption and the question for both exports, and gates G1-G7 pass. [oracle]
