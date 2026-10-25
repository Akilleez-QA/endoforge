# Mononoke mechanisms for Endoforge: source study

> Reconstructed 2026-10-17. The original Mononoke study (M, 16 October 2026) was not available; this
> version is a fresh source study of `facebook/sapling` at the commit the original reports, checked
> against the claims Edition 2 attributes to it [E2 §3, §7, §10, App. B]. Content follows Edition 3
> where the editions differ.

## Purpose

Edition 2 draws seven mechanisms from a source study of Meta's Mononoke and uses them to shape the Endoforge experiment ledger. The original study is lost. This document re-reads the upstream source at the pinned commit, states for each claim whether the source supports it, and says which mechanisms Endoforge should adopt in a small ledger of its own. It is source inspection only. Nothing upstream was built, run, ported or benchmarked.

## Summary

- The pinned commit `79071c2a3ea20c36ed71332608535e5801101bba` exists in `facebook/sapling`. No substitution was needed. **Recorded** (GitHub API, 2026-10-17).
- All seven Edition 2 claims are supported by the source at that commit. Six are **CONFIRMED**. Claim (g) is **CONFIRMED** for the mechanism; the "test-only" qualifier rests on the file's own doc comment, not on a search of production call sites.
- The commit also contains explicit lost-acknowledgment replay handling in bookmark transactions. It supports Edition 2's rule that a failed compare-and-swap alone does not prove nothing happened [E2 §10]. Whether the original study saw this code is unknown.
- Recommendation, unchanged from Edition 2: build a small Endoforge-native ledger that copies these mechanisms. Do not embed Mononoke or its dependency closure. **Proposed.**
- Limits: 19 files read at one commit; no execution; behaviour inferred from code and comments only.

## Scope and method

| Item | Value |
|---|---|
| Repository | `facebook/sapling`, subtree `eden/mononoke/` |
| Commit | `79071c2a3ea20c36ed71332608535e5801101bba`, committed 2026-10-14T20:23:55Z, subject "Multi-Repo Land stops retrying a contended land when the caller's budget cannot fit another attempt" |
| Commit status on 2026-10-17 | Exists. GitHub compare against `main`: identical (ahead 0, behind 0). |
| Retrieval | Recursive tree listing via `gh api repos/facebook/sapling/git/trees/<sha>?recursive=1`; files via `raw.githubusercontent.com/facebook/sapling/<sha>/<path>` |
| Integrity | Each file's Git blob SHA recomputed with `git hash-object` and matched against the tree entry; SHA-256 recorded |
| Files read | 19; listed with ranges, blob SHAs and reasons in `SOURCE-MAP.md` |
| Reproduction | `fetch-sources.sh <dir>` re-fetches and verifies the 19 files |
| Not done | No clone of the whole repository, no build, no tests, no execution, no WASM port |

Edition 2 reports that the original study also read 19 files or ranges at this commit, after a failed shell clone [E2 §10, App. B]. This re-study reached the same count, but the original file list is lost, so the two sets cannot be compared.

Section numbers 1–7 below follow the citations Edition 2 makes into M: §1 for identity, §3 for derivation, §5 for the memory store, §7 for conditional publication [E2 §3, §7, §10]. The original study's other section titles are unknown.

## Per-claim findings

Paths are relative to `eden/mononoke/` at the pinned commit. Line ranges are inclusive. All findings are **Upstream** (read from third-party source, pinned).

| Claim (as Edition 2 states it) | Verdict | Evidence | Paraphrase |
|---|---|---|---|
| (a) Bonsai changesets record ordered parents, metadata and changed-path mappings while file contents live separately | **CONFIRMED** | `mononoke_types/src/bonsai_changeset.rs` 41–60, 214–224, 350–390; `mononoke_types/src/file_change.rs` 93–110; `mononoke_types/src/file_contents.rs` 30–80; `mononoke_types/src/blob.rs` 92–94 | The changeset struct holds `parents` as a list, author/committer/dates/message/extras, and `file_changes` as a sorted map from path to `FileChange`. A `FileChange` holds a content id, file type, size and optional copy source, not bytes. File contents are a separate type addressed by `ContentId` and stored as a separate blob type. The changeset id is a hash of the serialized record. |
| (b) The derived-data framework separates canonical records from representations derived on demand | **CONFIRMED** | `derived_data/manager/derivable.rs` 36–62, 123–175; `derived_data/manager/manager/derive.rs` 403–427, 1221–1251 | Each derived type implements a trait that derives a value from a changeset and its inputs, then stores a changeset→value mapping. `derive()` first fetches an existing mapping and only derives (remotely, then locally) when none exists. |
| (c) The default batch derivation path is sequential in topological order because naive concurrent recursion can cause repeated derivation work | **CONFIRMED** | `derived_data/manager/derivable.rs` 40–43, 82–122 | The batch arrives in topological order. The default implementation loops one changeset at a time; the comment says it must have no parallelism or concurrency because dependencies between changesets may cause O(n²) derivations. Types may override it with a faster batch path. |
| (d) Ephemeral "bubbles" provide temporary storage overlays | **CONFIRMED** | `blobstore/ephemeral_blobstore/src/lib.rs` 8–13; `.../src/handle.rs` 23–101; `.../src/bubble.rs` 185–190, 254–312, 405–412; `.../src/store.rs` 55–68, 471–500; `.../schemas/sqlite-ephemeral-blobstore.sql` 8–40; `derived_data/manager/manager/bubble.rs` 13–91 | Blobs in a bubble are deleted when it expires; the lifespan can be extended. Reads try the bubble, then fall back to the persistent store; writes go to the bubble only. Bubble keys carry a bubble prefix. Expiry has a grace period, labels can keep a bubble alive, and deletion can be disabled, mark-only, or full. A bubble's derived data is computed by a secondary manager after the persistent part, with Git/Hg/filenode mappings disabled. |
| (e) Sharded maps support bounded loading | **CONFIRMED** | `mononoke_types/docs/sharded_map.md` 3, 7–11, 47–70, 96; `mononoke_types/src/sharded_map.rs` 302–345; `mononoke_types/src/sharded_map_v2.rs` 55–63, 400–445, 448–470 | A map is a compressed trie spread across blobs. Small subtrees (at most 2000 values in v1) sit inline in one terminal blob; intermediate nodes are inlined. A lookup loads only the blobs on its key's path. v2 bounds node size by a per-type weight limit. A batched update avoids writing temporary blobs that are never read again. |
| (f) Conditional publication (bookmark transactions / compare-and-swap) protects mutable references | **CONFIRMED** | `repo_attributes/bookmarks/src/transaction.rs` 22–44, 78–141, 165–180; `repo_attributes/bookmarks/dbbookmarks/src/transaction.rs` 70–87, 97–104, 585–630, 889–990 | `update` and `delete` succeed only if the bookmark still points at the expected old changeset. In SQL this is an `UPDATE … WHERE changeset_id = old` whose affected-row count must be exactly 1. A lost race is a logic failure, returned as `None` rather than an error; infrastructure failures are errors; retryable errors are retried a bounded number of times. Unconditional `force_set`/`force_delete` also exist. |
| (g) A test-only in-memory blob store removes link entries without reclaiming payload entries on those paths | **CONFIRMED** (mechanism); test-only per doc comment | `blobstore/memblob/src/lib.rs` 33–39, 48–55, 89–91, 94–96, 181–189 | The store keeps a payload table (id→bytes) and a link table (key→id). `unlink` removes only the link. Nothing in the file ever removes a payload entry. An overwrite also allocates a new payload id and leaves the old payload in place. The struct is documented as a pure in-memory implementation for testing. |

### Additional finding relevant to (f): lost-acknowledgment replay

**Upstream.** At this commit the bookmark transaction code distinguishes a replay of a write whose acknowledgment was lost from a genuine divergence:

- `repo_attributes/bookmarks/src/transaction.rs` 33–52 defines an `AlreadyProcessed` error and a `BookmarkMoveAlreadyProcessed` marker. The comment states that a compare-and-swap matching no rows can mean any divergence on its own; the already-advanced log id is what identifies the replay.
- `repo_attributes/bookmarks/dbbookmarks/src/transaction.rs` 240–280 and 400–445 describe the mirror path: lock the row, drop moves already applied (by source log id), apply the rest as one compare-and-swap, and treat "nothing left to apply" as a replay. A row at the expected log id with a different changeset is reported as divergence.
- The same file, 946–964, maps a lost race to `Ok(None)` and a replay to a distinct error, so callers can advance a checkpoint instead of retrying forever.

This path covers only the `modern_sync` mirror replicas. It is not a general lost-ack protocol for every bookmark move.

## 1. Identity: the record is not the content

**Upstream.** A Bonsai changeset is a small, frozen record. `freeze` checks internal consistency (no newlines in author, copy sources must be listed parents, no path conflicts, untracked changes only in snapshots) and computes the id from the serialized record (`bonsai_changeset.rs` 214–308). The comment at 233–236 says these checks cannot validate anything outside the changeset, such as deleting a file the parent lacks. Contents live under their own `ContentId` (`file_contents.rs` 75–95), so many changesets can reference the same bytes.

For Endoforge this is the template for separating history from computation: a proposal record names its parents and the changes it makes, and points at content by hash. Validity of the record is not validity of the change.

## 2. Typed blobs

**Upstream.** `blob.rs` 92–116 declares one blob type per key type: changesets, contents, content chunks, and one for each derived representation (unodes, fsnodes, skeleton manifests and others). A key's type says what kind of object it names.

## 3. Derivation on demand, sequential by default, closure before mapping

**Upstream.**

- Canonical versus derived: derived types state their dependencies, and the manager derives dependencies first (`derivable.rs` 54–62). The changeset→value mapping is persisted separately (`derivable.rs` 123–158).
- On demand: `derive()` returns an existing mapping when present and derives only otherwise (`derive.rs` 403–427). The remote path re-checks for a mapping before each attempt, because someone else may have derived it already (`derive.rs` 580–583).
- Sequential default: see claim (c).
- Shared work: when deriving heads, each derived type's dependency derivation is stored as a shared future in a per-call `visited` map, so one call tree derives a dependency type once (`derive.rs` 96–100, 185–325). This is in-process sharing keyed by derived type. It is not a cross-process lock or lease; none was found in the files read.
- Closure before publication: derived blobs are flushed before the mapping is written, and the mapping is flushed before the rederivation mark is cleared (`derive.rs` 478–496, 874–916). A mapping therefore never points at derived data that is not yet stored.

## 4. Bubbles

**Upstream.** See claim (d). Two further details matter for Endoforge:

- The owner identity is stored in the bubble table (`sqlite-ephemeral-blobstore.sql` 8–14), but opening a bubble does not check it; there is a `TODO` to do so (`store.rs` 602).
- Deleting a bubble marks it expired first, then unlinks each blob, then deletes metadata (`store.rs` 471–500; `bubble.rs` 317–332). Physical reclamation therefore depends on what `unlink` does in the backing store. Section 5 shows a store where it frees nothing.

## 5. Reclamation in the in-memory store

**Upstream.** See claim (g). This is a property of a test store. It is not evidence that any production Mononoke store leaks. Edition 2 already says so [E2 §3]. Its value to Endoforge is the general lesson: removing a name and reclaiming bytes are separate operations, and a design must say which one happened.

## 6. Sharded maps

**Upstream.** See claim (e). The design keeps lookup cost proportional to the path length, not the map size, and keeps write amplification low by batching replacements into one update.

## 7. Conditional publication

**Upstream.** See claim (f) and the additional finding. Three properties carry over: the expected-old-value check is the only thing that makes the move safe; a lost race returns a distinct, non-error outcome; and an ambiguous outcome is resolved by reading authoritative state (the log id), not by assuming the write failed.

## Mechanisms for Endoforge

Everything in this section is **Proposed**. Endoforge should build a small ledger of its own that copies these mechanisms. It should not embed the Mononoke server, port it to WASM, or take on its dependency closure. Mononoke serves a large multi-tenant source-control service; Endoforge needs a ledger for candidates, builds, evaluations and activations inside one factory [E2 §10; E3 §9]. R11 gives the schema.

| Mononoke mechanism (source) | Endoforge adoption | Not adopted |
|---|---|---|
| Frozen changeset record with hashed id; contents by separate id (§1) | Candidate/provenance record that names parents and changes and points at content by hash. Record id = hash of canonical serialization. | Git/Hg compatibility fields, snapshot and subtree semantics |
| Typed keys (§2) | Every identity is typed: `cand:`, `src:`, `bkey:`, `art:`, `eval:`, `act:`. A hash never crosses types. | — |
| Derive on demand, mapping stored separately (§3) | Builds, indexes, packaging and explanations are derived from complete pinned inputs only when the next step needs them. Gates required for activation stay in the required closure. | Remote derivation service |
| Sequential default batch; shared per-type futures (§3) | One in-flight derivation per build key; compatible callers join it. Coalescing is keyed by the full build key, which includes configuration and trust scope [E2 §7]. | Global ordering of all work by commit graph |
| Flush derived data before writing the mapping (§3) | Publication after closure: an index entry, activation or receipt is written only after every object it references is durable [E3 §9]. | — |
| Bubbles: read-through overlay, prefix, expiry, grace, labels (§4) | The attempt overlay of E3 §9: per-candidate scratch that reads through to the warm base, writes only to itself, and expires. A label (retain flag) promotes a scratch object deliberately. | SQL-backed bubble service |
| Owner stored but not checked (§4) | Ownership is checked on every open and every reclamation. | — |
| Memblob unlink keeps payloads (§5) | Reclamation is explicit and measured in bytes: unlinking a name, releasing a reference, and freeing storage are separate, recorded states. | — |
| Sharded maps (§6) | Large indexes (artifact→evaluations, invariant library) load by key path, not wholesale, once they outgrow a single blob. Not needed for the first slice. | The trie format itself |
| Conditional bookmark update; lost race is a non-error result (§7) | Activation is a compare-and-swap on a named slot with an expected previous activation. A lost race leaves the candidate inactive. | Mirror-replica sync |
| Replay detected by an already-advanced log id (§7, additional finding) | Every activation attempt carries an idempotency key. After a lost acknowledgment, reconcile by reading the authoritative activation record, never by inferring from the compare-and-swap result alone [E2 §10; E3 §9]. | — |

What Mononoke does not supply, and Endoforge must add:

- An observations journal. Mononoke's derived data is regenerable; an evaluation timing, model output or reviewer judgment is not, and must be journalled with its scope [E2 §10].
- An evaluator identity frozen before evaluation [E3 §6].
- An outcome-unknown state for attempts interrupted after authorization [E3 §9].
- A link from ledger state to incremental compiler state. A changeset record is not an incremental compiler graph [E2 §10].

## Edition 3 alignment

- Edition 3 keeps the ledger outside every isolate cohort with the controller, so losing a process loses attempts, never the task [E3 §9]. The adoption table above fits that placement.
- Edition 3's three lifetimes map onto the mechanisms: durable (canonical records, mappings, activations, journal), warm (derived builds and caches, evictable), attempt (bubble-like overlays) [E3 §9].
- Edition 3 §16 places content-addressed builds and durable execution in prior art and states that a hash names bytes and never grants permission. This study's adoption table is consistent with that.
- Edition 3 §18 carries the study forward as "nineteen files inspected, no build or tests run". That remains true of this re-study.
- Nothing in Edition 3 contradicts the Edition 2 claims checked here.

## Limitations

- Source reading only. No claim here is about runtime behaviour, performance, or production correctness.
- One commit. On 2026-10-17 it was also the tip of `main`; later commits may change any of this.
- 19 files. Callers, configuration, production blobstore implementations and tests were not read. In particular, whether `Memblob` is ever used outside tests was not searched.
- The original study's file list, wording and conclusions are lost. Agreement in count (19) is not evidence of identical scope.
- Line ranges are for the pinned commit only.

## Open questions

- Does any production Mononoke path use `Memblob` or another store whose `unlink` does not reclaim payloads? Would need a call-site search; not needed for Endoforge's design. (No work package assigned.)
- Does Mononoke coalesce identical derivations across processes (leases or similar)? Not found in the files read. Relevant to the coalescing design in R07 and R11.
- Was the lost-ack replay code present when the original study ran on 16 October 2026? The pinned commit is dated 14 October 2026, so it should have been, but the original study's text is lost.

## Sources

- `facebook/sapling` at `79071c2a3ea20c36ed71332608535e5801101bba`, files listed in `SOURCE-MAP.md`. **Upstream.**
- [E2 §3] "Scrap and reclamation"; [E2 §7] "Coalesce dependencies instead of multiplying them"; [E2 §10] "The ledger belongs inside the factory, not at its center"; [E2 App. B] entry M.
- [E3 §6], [E3 §9], [E3 §16], [E3 §18].
