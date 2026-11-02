# P-32 MEASURE: where time goes inside one generation call

One baseline run on main 9b7843e, 2026-11-02 03:58 EST, 30 requests, width 10, effort auto, resume on. Each Codex event was timestamped by a wrapper outside the checkout. 28/30 promoted.

| stage | p50 s | p95 s | input tokens p50 | cached p50 | output tokens p50 | commands run |
|---|---|---|---|---|---|---|
| specification | 34.9 | 52.9 | 32,767 | 28,608 | 1,128 | 0 |
| implementation (resumed) | 20.4 | 29.2 | 71,253 | 61,952 | 1,997 | 0 |

Every call has the same shape: three model requests. A preamble message (first item p50 5.8 s spec, 4.6 s implementation), one file edit, then a closing summary (p50 4.0 s and 3.3 s after the last file). No call ran a command, so there is no tool exploration to cap. Cache hit is already 87-93% of input. An empty prompt alone costs 15,174 input tokens.

Order chosen from this: (1) drop the preamble and summary turns, about 8-9 s of each request; (2) a fresh pre-packed implementation context instead of the 71k-token resumed thread; (3) a stable prompt prefix, last because the cache already hits.
