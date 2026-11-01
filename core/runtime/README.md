# Runtime

Generic utilities for independent local workflows. Supply your own inputs and output directory. Use synthetic examples when sharing configurations.

Run agent-pool.mjs with an explicitly configured client and account directories. It supports public Codex CLI invocations and checks account-marker presence without reading credential contents.

Worker-registry integration requires WORKERS_BIN explicitly; no host registry is discovered automatically.
