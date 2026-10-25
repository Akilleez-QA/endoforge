# Atomization of C-005

Model sonnet; attempts 1; valid: true. Prompt sha256 59e82775fb7c514f…

Atoms 13; total work 24; critical path 10 (iface → contract → k-tot → compose → rev-tech); speedup bound 2.4x; widest wave 7.

| Wave | Atoms |
|---|---|
| 0 | iface (interface, sonnet, w1/i1) |
| 1 | contract (contract, sonnet, w2/i2) |
| 2 | k-liq (kernel, sonnet+tools, w2/i1); k-gas (kernel, sonnet+tools, w2/i1); k-tot (kernel, sonnet+tools, w3/i1); t-liq (tests, sonnet, w2/i1); t-gas (tests, sonnet, w2/i1); t-tot (tests, sonnet, w2/i1); glue (glue, sonnet, w2/i2) |
| 3 | compose (compose, sonnet+tools, w3/i2) |
| 4 | rev-tech (review, sonnet, w1/i1); rev-eng (review, codex, w1/i1); rev-safety (review, opus, w1/i1) |

## Acceptance (from the need)

- A1: The composed artefact passes all gates and is promotable. [command]
- A2: The kernel exports the three line-charge functions and has no imports. [command]
- A3: For the requester's case (1 m, 1/4 in liquid line, 1/2 in gas line, R410A code 1) the total is finite, positive and equals liquid plus gas line charge within 1e-9 g. [command]
- A4: Zero length, negative length, non-finite length, an unknown refrigerant code and an unsupported pipe size are refused (trap) by the kernel. [command]
- A5: tests.json contains both value tests and expectError tests for every export. [command]
- A6: glue.json records a non-empty assumption and a non-empty question, and CONTRACT.md mentions both. [command]
- A7: The artefact answers both parts of the request (how much, and what type) without guessing the refrigerant: the type is an explicit coded input, and the single question asks the technician for the unit model/refrigerant and the manufacturer's pre-charged line length and additional-charge rate. [oracle]
