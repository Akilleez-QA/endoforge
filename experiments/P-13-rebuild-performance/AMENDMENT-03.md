# P-13 attempt 03 — clean host fetch, offline image build

**Proposed before attempt 03, 18 October 2026.** Host-network Docker setup stalled and hit its 120-second timeout; its exact identified build clients were explicitly cancelled and the failed attempt preserved. Do not claim that failed setup terminated automatically.

Reconstruct dependencies in a NEW host directory with pinned Node 22.18.0 from P-09, the installed npm CLI (record identity/version), exact unchanged package lock, a new empty cache, user/global config disabled, scripts disabled and bounded registry fetches. Do not use the existing dependency directory or cache. Copy only these freshly fetched dependencies into the image build context and build with networking disabled. This qualifies a clean dependency reconstruction, not an identical npm-version rebuild. Compare all dependency content and symlink targets excluding generated npm installation metadata; the original parity criteria remain unchanged. All measured workloads remain offline.

The host subprocess controller now captures timeout outputs and explicitly terminates the identified process group before continuing. Unique probe attempt directories preserve prior receipts. Model inference and app integration remain excluded.
