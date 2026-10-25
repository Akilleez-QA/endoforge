# Mononoke study: source map

> Reconstructed 2026-10-17. The original source map was not available; this map lists what this
> re-study actually inspected, from `facebook/sapling` at the pinned commit. It is not a copy of the
> original map, whose file list is unknown. Content follows Edition 3 where the editions differ.

## Purpose

List every upstream file and line range read for `STUDY.md`, with its Git blob SHA and SHA-256, and say why it was read. `fetch-sources.sh` re-fetches exactly these files and verifies them.

## Summary

- Repository `facebook/sapling`, commit `79071c2a3ea20c36ed71332608535e5801101bba` (committed 2026-10-14T20:23:55Z). **Upstream.**
- The commit exists. On 2026-10-17 the GitHub compare API reported it identical to `main` (ahead 0, behind 0). **Recorded** (this session, 2026-10-17).
- 19 files were read, all under `eden/mononoke/`. Edition 2 also reports 19 files or ranges for the original study [E2 §10, App. B]. The count matches, but nothing shows the two lists are the same.
- Every file was fetched from `raw.githubusercontent.com/facebook/sapling/<commit>/<path>`. Its Git blob SHA was recomputed locally (`git hash-object`) and matched the tree entry at the commit. **Recorded** (this session).
- Nothing upstream was built, run or tested.

## Files and ranges

Line numbers refer to the file at the pinned commit. "Claim" refers to claims (a)–(g) in `STUDY.md`.

| # | Path (under `eden/mononoke/`) | Git blob SHA | Bytes | Ranges read | Why | Claim |
|---|---|---|---|---|---|---|
| 1 | `mononoke_types/src/bonsai_changeset.rs` | `695adb09ed22767a0aa287c4ed2cf66ba686e5ef` | 38651 | 41–80, 214–330, 350–390, 440–476 | Changeset record fields, id computation, `freeze`/`verify`, accessors | a |
| 2 | `mononoke_types/src/file_change.rs` | `3be4d811747e1aa92ee8e9d099b6442107a296e9` | 20242 | 25–35, 88–140 | `FileChange` variants carry a content id, type and size, not bytes | a |
| 3 | `mononoke_types/src/file_contents.rs` | `fa32892765f3cf6c6d2692e3ecf7ca1177090663` | 9906 | 27–95 | File contents are a separate type with their own `ContentId` | a |
| 4 | `mononoke_types/src/blob.rs` | `1183e6b7846b4c987532196e03f9eecbfcabae80` | 4253 | 40–129 | Typed blobs: `ChangesetBlob`, `ContentBlob` and derived-data blobs are distinct key types | a, b |
| 5 | `derived_data/manager/derivable.rs` | `301818c4d6df54eb613934a5ce73bbb67c2cd332` | 17889 | 36–175 | `BonsaiDerivable` contract; default `derive_batch` is sequential; mapping storage and fetch | b, c |
| 6 | `derived_data/manager/manager.rs` | `c3a6e7605b0f28c5b5454140330dd16c82d14901` | 10840 | 30–130, 277–290 | Manager role; primary/secondary manager split used for bubbles | b, d |
| 7 | `derived_data/manager/manager/derive.rs` | `42d72ce9efedb212b94d99e07c7a65cc37c21d62` | 51892 | 60–125, 164–325, 395–500, 518–640, 642–680, 720–740, 870–925, 1215–1260 | Derive-or-fetch path, shared per-type futures, remote derivation fast path, flush-before-mapping order | b, c |
| 8 | `derived_data/manager/manager/bubble.rs` | `08686ed5f013be02392515aa1fa53ad186d31909` | 3180 | 1–91 (whole file) | Derived-data manager for a bubble; which changesets derive where | d |
| 9 | `blobstore/ephemeral_blobstore/src/lib.rs` | `662eda8689536e2921f9f1bf7b234a2c0aa551c8` | 1106 | 1–36 (whole file) | Module doc: bubbles, expiry, extension | d |
| 10 | `blobstore/ephemeral_blobstore/src/bubble.rs` | `5e1112734d4e32ee1e22888abd850f961380bb51` | 17048 | 60–90, 180–260, 280–415 | `BubbleId`, prefixing, expiry status, `wrap_repo_blobstore` | d |
| 11 | `blobstore/ephemeral_blobstore/src/handle.rs` | `89aaef674b83a719148ec20915acddff7662b381` | 2809 | 1–101 (whole file) | Read-through overlay: bubble first, then persistent store; writes go to the bubble | d |
| 12 | `blobstore/ephemeral_blobstore/src/store.rs` | `6340895b4abe448a93f8bc7f4157ff6ca71ce033` | 89823 | 30–75, 410–500, 600–715, 745–870 | Lifespan, grace period, deletion modes, delete sequence, TTL extension | d |
| 13 | `blobstore/ephemeral_blobstore/schemas/sqlite-ephemeral-blobstore.sql` | `eaf8e7353614e6e688de2de57f7aceed3447ebbd` | 1249 | 1–40 (whole file) | Bubble metadata: expiry, owner, labels, changeset and ordered-parent tables | a, d |
| 14 | `mononoke_types/docs/sharded_map.md` | `4190017cc6381d544001fcefc05fe907429c0833` | 9749 | 1–158 (whole file) | Design of sharded maps; why only a few blobs load per lookup | e |
| 15 | `mononoke_types/src/sharded_map.rs` | `64179a35cb9dc36e471f77a008d0602ec162025b` | 82194 | 50–130, 300–345, 589–600, 786–830 | Node types, lazy child load, lookup cases | e |
| 16 | `mononoke_types/src/sharded_map_v2.rs` | `d95ab85a660f5e1425dc8cfa4e68d50e93c420ee` | 85909 | 50–145, 300–320, 400–470 | Weight limit per node, inlining rule, lookup | e |
| 17 | `repo_attributes/bookmarks/src/transaction.rs` | `066e8d991ac06cfd1cc340ece46742a77ff75109` | 7612 | 1–181 (whole file) | Bookmark transaction contract: conditional update/delete, error classes, lost-ack marker | f |
| 18 | `repo_attributes/bookmarks/dbbookmarks/src/transaction.rs` | `c3df233f51acd2e56a4c8e8a4cbf24bbf492d286` | 41180 | 55–155, 240–280, 400–445, 555–630, 889–990 | SQL compare-and-swap, replay detection, commit/retry classification | f |
| 19 | `blobstore/memblob/src/lib.rs` | `53050420ff062c309fb4480f68fbc0cc82acb2df` | 8298 | 1–308 (whole file) | In-memory test blob store: link table versus payload table | g |

## SHA-256

The SHA-256 of each file, as fetched, is in the manifest inside `fetch-sources.sh`. The first 16 hex digits are repeated here for quick comparison.

| # | SHA-256 prefix |
|---|---|
| 1 | `29a4737e8b8e350f` |
| 2 | `6f41a583cec18fe3` |
| 3 | `696d77218a26b614` |
| 4 | `dcd707cebe7c1db3` |
| 5 | `c998364d3030f96d` |
| 6 | `99402e768908b7d3` |
| 7 | `026239cbdf88b7e5` |
| 8 | `7e7d88669a4bdbda` |
| 9 | `64388817897d0501` |
| 10 | `409b3d4785778de4` |
| 11 | `83de570d984dcd11` |
| 12 | `0f569b83694048fa` |
| 13 | `682b6b58374db3ff` |
| 14 | `a1ec7436b0027749` |
| 15 | `e3de02c06b60609c` |
| 16 | `cb068ca9bb8b84cb` |
| 17 | `00511d5735860409` |
| 18 | `1e4f57ee78ed1cd2` |
| 19 | `0f164f40dafd2c0a` |

## Files located but not read

The tree listing at the commit also showed these related paths. They were not read and no finding rests on them: `blobstore/ephemeral_blobstore/src/{builder,commit_graph,error,file,view}.rs`, `derived_data/manager/{context,error,lib,stage_payload}.rs`, `derived_data/manager/manager/{logging,util}.rs`, `repo_attributes/bookmarks/{src,dbbookmarks/src}/lib.rs`, `.llms/rules/sharded_map_v2_correctness.md`, and the integration tests under `tests/integration/ephemeral_store/`.

## Reproducing

```
docs/studies/mononoke/fetch-sources.sh /path/to/empty/dir
```

The script downloads the 19 files at the pinned commit, checks SHA-256, byte size and (when `git` is present) the Git blob SHA, and writes `FETCH-RECEIPT.txt` in the target directory. It exits non-zero on any mismatch. It was run once on 2026-10-17 into a scratch directory and reported all 19 files verified. **Recorded** (this session).

## Sources

- `https://github.com/facebook/sapling/tree/79071c2a3ea20c36ed71332608535e5801101bba/eden/mononoke`
- GitHub REST API: `repos/facebook/sapling/commits/<sha>`, `git/trees/<sha>?recursive=1`, `compare/<sha>...main`, queried 2026-10-17.
- [E2 §10], [E2 App. B] for the original study's reported scope.
