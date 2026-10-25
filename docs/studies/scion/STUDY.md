# Anthropic Scion and its relation to Mononoke: source study

> Written 2026-10-17. This is a new study, not a reconstruction. Edition 2 cites "the Scion
> discussion" as the reason the project studied Mononoke [E2 §10] but kept no Scion sources
> [E2 App. B]. This document finds and reads those sources. Content follows Edition 3 where the
> editions differ.

## Purpose

R10 says Edition 2's ledger work started from a discussion of Scion, and it marks every Scion detail as unverified because no source was available. This study reads Anthropic's own description of Scion and checks the claims that secondary coverage makes about it. It also reads the public attribution critique that tied Scion to Meta's Mononoke, and maps Scion's published design onto the Mononoke mechanisms verified in `docs/studies/mononoke/STUDY.md`. Everything here comes from published text. Scion is closed source and nothing about it was run, inspected or measured.

## Summary

- Scion is Anthropic's in-house version control system for its monorepo. Anthropic described it in an engineering post on 13 October 2026, updated on 15 October. Every claim listed in the brief was found in that post, and secondary coverage made none of them up. **Upstream** (self-reported by Anthropic; not independently verifiable).
- Scion's design is close to Mononoke's at the level the post describes. Both use a changeset that stores per-file changes against a parent and points at content by hash. Both use a generic derived-data mechanism for blame, history and graph indexes. Both move refs by compare-and-swap. The post says nothing about bubbles, sharded maps or a sequential batch-derivation default.
- Rain (sunshowers), who helped build Mononoke at Meta, said on 14 and 15 October that the post did not credit Mononoke properly. The post's author replied on Hacker News on 15 October and added a footnote that names Mononoke and its Bonsai data model. Rain then wrote that the attribution was now sufficient and that they stood by their earlier posts. The two sides still disagree about how much was copied.
- For Endoforge, Edition 2's claim that source control becomes a bottleneck at machine-generated change volume is now an observed fact at Anthropic's scale. **Upstream.** Scion's merge rate, applied to sixteen-candidate campaigns, would mean roughly 5 to 11 candidates or attempts a second (**Derived, illustrative**). Scion's few refs, server-side operations, changeset-relative storage and on-demand derived data all fit the candidate ledger in R10/R11. **Proposed.**
- Endoforge still builds a small native ledger. Scion is not released, would be built for a very different workload anyway, and lacks the observation journal and evaluation records that the ledger needs.

## Scope and method

| Item | Value |
|---|---|
| Primary source | Anthropic, "Redesigning source control at Anthropic", <https://www.anthropic.com/engineering/redesigning-source-control>. Published 13 Oct 2026; banner says updated 15 Oct. |
| How it was read | Fetched in full with `curl` on 2026-10-17 and converted to text. WebFetch also loaded it. Nothing was blocked. |
| Version history | Wayback Machine CDX lists ten captures from 13 to 17 Oct 2026. Captures `20261013155925`, `20261015011001` and `20261016080325` were downloaded and diffed against the live page. |
| Critique | Rain, "Anthropic's Scion is heavily inspired by Mononoke", <https://sunshowers.io/posts/anthropic-mononoke/> (dated 2026-10-14), and "More on Anthropic's Scion ripping off Mononoke", <https://sunshowers.io/posts/anthropic-mononoke-2/> (dated 2026-10-15). Both read in full. |
| Hacker News | Story metadata read through the HN Firebase API: 50073633 (Anthropic post), 50094694 (first critique), 50106738 (follow-up). Comment 50107559 (Anthropic's reply) read in full. The threads as a whole (about 1,000, 161 and 89 comments) were **not** read. |
| Secondary | braindetox.kr and ai-tldr.dev pages read through WebFetch summaries. zeli.app read only for its link to the HN story. Trade press (The New Stack, FourWeekMBA, Xenospectrum) was not needed, because the primary sources were reachable. It was not read. |
| Name clash | `GoogleCloudPlatform/scion` README and GitHub API metadata read. |
| Not read | The images embedded in Rain's posts (side-by-side screenshots), Rain's 2022 Oxide materials, the Lobsters thread, Bluesky and LinkedIn posts, the ghostarchive copy linked by Rain, Martin Kleppmann's post cited in Anthropic's reply, and Cursor's "git at any scale" post. |

Verdicts: **CONFIRMED in primary** means that the claim appears in Anthropic's post with the stated meaning. **SECONDARY ONLY** means that the claim was found only in coverage. **NOT FOUND** means that it is absent from the post. **CONTRADICTED** means that the post says otherwise.

## Claims table

All rows cite the primary post, <https://www.anthropic.com/engineering/redesigning-source-control> (read 2026-10-17), unless another URL is given.

| # | Claim (as reported by secondary coverage) | Verdict | What the post says |
|---|---|---|---|
| 1 | More than 30,000 merges a day in Sep 2026, up from about 2,500 in May | **CONFIRMED in primary** | Around 2,500 code changes merged per day in May 2026, and over 30,000 per day as of September. The post also says merges grew "more than tenfold". |
| 2 | Main-branch history of almost 100 GB; compressed working copy over 25 GB | **CONFIRMED in primary** | Both figures appear as stated. The post also gives about 25 million CI checkouts a day, which would be over 600 PB of git traffic a day if fetched naively. |
| 3 | Several hundred git mirrors at peak | **CONFIRMED in primary** | "Several hundred internal git mirrors" at peak, alongside shallow clones, sparse checkouts, promisor remotes and seeds in blob storage. |
| 4 | Migration completed in 5 months | **CONFIRMED in primary** | The monorepo was fully migrated from git in five months. Over the same period the team also built Antique (code review), code search and source-control IAM. |
| 5 | Always-online clients (agents, CI, dev environments) | **CONFIRMED in primary** | "Clients are always online" is the first principle. The post says nearly all clients are agents and jobs. It mentions developer environments only as extra checkout consumers, not as a separate class of client. |
| 6 | Server-side commits, rebases and merges | **CONFIRMED in primary** | Every commit, rebase and merge happens on the server, so nothing is pushed. The server also answers history and blame queries. |
| 7 | Changesets store changed files relative to the first parent, with content-addressed pointers to compressed blobs | **CONFIRMED in primary** | Yes. Footnote 1 calls first-parent storage for merges a stylistic choice that suits trunk-based development. |
| 8 | Sparse and virtualized checkouts | **CONFIRMED in primary** | Sparse checkouts contain only the directories the client requests. Virtualized checkouts materialize files on demand. Many read and write jobs skip the checkout and use the API instead. |
| 9 | Refs discouraged except main and release branches | **CONFIRMED in primary** | The post gives the reason: global state that every server must agree on is a scaling problem. Refs do exist; moving one is a compare-and-swap on a single Spanner row. |
| 10 | 200x smaller CPU and memory footprint than the git mirroring | **CONFIRMED in primary** | 200x smaller than the previous git mirroring infrastructure in CPU and memory. Each cache tier has a hit rate above 99%. |
| 11 | Checkouts two orders of magnitude faster | **CONFIRMED in primary** | CI and research checkouts take seconds rather than minutes. CI alone gained 25% CPU capacity. |
| 12 | Per-directory permissions | **CONFIRMED in primary** | Rich access control on repositories, plus permissions on individual directories. Code review can express semantic approval rules. |
| 13 | A Claude-written rewrite of the ingestion pipeline used 20x less memory and ran 4x faster | **CONFIRMED in primary** | An early internal snapshot of Claude Mythos Preview rewrote the largely handwritten git-to-Scion ingestion prototype. The post says the rewrite kept the ordering and data-structure invariants. |
| 14 | No plan to release Scion | **CONFIRMED in primary** (in substance) | The post does not use the words "no plan to release". It says Scion is not a suitable git replacement for general use. It also says that offering Scion in a broadly useful form is difficult, and that Anthropic will share ideas and work with git forges instead. |
| 15 | The 15 Oct update added detail on prior art (Piper, Sapling) | **CONTRADICTED in part** | Piper and Sapling were both named and linked in the 13 Oct capture. The 15 Oct update added footnote 2. That footnote says the Sapling credit means specifically Mononoke, Sapling's server, which pioneered many of Scion's techniques, especially the Bonsai data model. |
| 16 | The original post did not mention Mononoke | **CONFIRMED in primary** (13 Oct and 15 Oct 01:10 UTC captures) | Mononoke and Bonsai appear only in the capture from 16 Oct 08:03 UTC onward. |
| 17 | A team of seven built it | **CONFIRMED in primary** | Seven people built Scion, Antique and about six related systems. |

Footnote 2 links "Bonsai" to `eden/mononoke/mononoke_types/serialization/bonsai.thrift` at sapling commit `79071c2a3ea20c36ed71332608535e5801101bba`. That is the same commit the Mononoke study is pinned to. Edition 2's original study came after the update, so it may have taken the commit from this link. That is not established.

## Scion's design

All of this section is **Upstream**: it is Anthropic's description of its own system. Anthropic gives no code, schemas or benchmarks, so none of it can be checked independently.

### Always-online

Git assumes clients may work offline, so each client holds a full repository. Anthropic observed that it used git centrally with one authoritative copy, and that nearly all its clients were agents and jobs that are online by definition. Scion is designed around a server that is always reachable. Clients fetch data only when they need it.

### Server-side operations

The client keeps a bounded object cache, lays out working-copy files and watches the filesystem. It can compute very little by itself. The server creates commits, performs merges and rebases, and answers history, blame, diff and merge-base queries. The same queries are exposed through an API, so many tools (for example automated bisect and revert pipelines) need no local repository. The cost of a commit, including updating the structures downstream of it, has to scale with the size of the change, not the size of the repository.

### Changeset model

The unit is a changeset, an entry in a write-ahead log. It lists the files that changed relative to its first parent, with content-addressed pointers to compressed file contents in blob storage, instead of pointing at a full tree. Changesets are created on the server. Accepting a changeset involves no packfiles, no locking, no cross-server coordination and no ref movement, which is why throughput is high.

### Derived data

Anything that is not part of the changeset is "derived data": blame structures, path history, skip lists over the commit graph, and later indices for copy detection and path search. One generic mechanism computes all of it. Each type is defined recursively, so its value for a changeset is computed from its values for the parents. Each type can be computed eagerly or deferred. Clients never see the internals, so the server can change them. Servers compute derived data on the fly and write it back to Spanner.

### Checkouts

The `scn` client does not tell the server what it already has. It starts from a root tree and recursively requests the trees and then the blobs it is missing. Every request names an immutable object, so any cache can answer it, and a transfer can resume. Sparse and virtualized checkouts need no special support, because the client simply does not ask for what it does not need. The cache tiers are strict: `scion-daemon` serves each node and starts from a periodically refreshed snapshot, `scion-cache` serves each region, and `scion-server` is authoritative and reads from Spanner or cloud storage. All three tiers answer the same RPCs. Tiers are not allowed to skip one another, so that a regional failure cannot overwhelm the authoritative servers. No complete copy of the repository is materialized anywhere, even on the server, and no repository maintenance (such as packfile repacking) is needed.

### Refs and global state

Refs are discouraged except for main and release branches. The reason given is that global state every server must agree on is a scaling problem. Creating and fetching commits never touches a ref. Moving a ref is a separate compare-and-swap on a single Spanner row. The post also says a merge queue with a global repository lock does not work at agent scale. Anthropic relies on post-merge and pre-deploy testing instead and accepts that concurrent changes can conflict.

### Permissions

Scion supports access control on whole repositories and permissions on individual directories, so sensitive code can be protected inside the monorepo. The Antique review tool can express semantic approval rules, for example to tell a comment-only change from a change in logic.

### Scale numbers

| Quantity | Value | Label |
|---|---|---|
| Merges per day, May 2026 | about 2,500 | Upstream |
| Merges per day, Sep 2026 | over 30,000 | Upstream |
| Main-branch history | almost 100 GB | Upstream |
| Compressed working copy | over 25 GB | Upstream |
| CI checkouts per day | on the order of 25 million | Upstream |
| Naive git traffic per day | over 600 PB | Upstream (Anthropic's own estimate) |
| Git mirrors at peak | several hundred | Upstream |
| Cache hit rate per tier | over 99% | Upstream |
| CPU and memory vs git mirroring | 200x smaller | Upstream |
| Checkout speed | two orders of magnitude faster (seconds, not minutes) | Upstream |
| CI CPU capacity freed | 25% | Upstream |
| Ingestion rewrite | 20x less memory, 4x faster | Upstream |
| Team / time | 7 people / 5 months | Upstream |

**Derived.** 30,000 ÷ 2,500 = 12, consistent with the post's "more than tenfold". 30,000 merges a day is about 0.35 a second (30,000 ÷ 86,400) averaged over the day.

## Scion ↔ Mononoke

The Mononoke column comes from `docs/studies/mononoke/STUDY.md`, which read source at sapling `79071c2a`. The Scion column comes from the post only. "Match" describes the published descriptions. It says nothing about the code, which is closed.

| Mononoke mechanism (STUDY ref) | Mononoke, verified in source | Scion, per the post | Match |
|---|---|---|---|
| Bonsai changesets (claim (a), §1) | Frozen record: ordered parents, metadata, sorted path→`FileChange` map. Contents are a separate blob addressed by `ContentId`. The id is a hash of the record. | A write-ahead-log changeset listing the files changed against the first parent, with content-addressed pointers to compressed blobs. Created on the server. | **Close.** Same shape. Scion stores changes only against the first parent. Whether Scion's id hashes the record is not stated. |
| Derived data framework (claim (b), §3) | Each derived type implements one trait. The changeset→value mapping is stored separately. `derive()` returns an existing mapping or derives one. Derived data is flushed before the mapping is written. | One generic mechanism. Each type is defined recursively from parent values and can be eager or deferred. Clients never see the internals. Values are computed on the fly and written back to Spanner. | **Close.** Same concept, and the same name. The post says nothing about how publication is ordered. |
| Sequential batch derivation (claim (c)) | The default batch path runs in topological order, one changeset at a time, to avoid O(n²) repeated derivation. | Not described. | **NOT FOUND** in Scion. |
| Bubbles (claim (d), §4) | Ephemeral overlay with a key prefix, expiry, grace period and labels. Reads fall through to the persistent store; writes stay in the bubble. | Not described. No ephemeral or draft storage tier is mentioned. | **NOT FOUND** in Scion. |
| Sharded maps (claim (e), §6) | Compressed trie spread across blobs. A lookup loads only the blobs on its key's path. | Not described. The fetch protocol walks trees recursively and fetches only what is missing, which is a related form of bounded loading at the tree level. | **NOT FOUND** as a structure. A related principle is present. |
| Conditional publication (claim (f), §7) | A bookmark update is a compare-and-swap against the expected old changeset. A lost race returns a distinct non-error result. Lost-acknowledgment replay is detected by log id. | A ref move is a compare-and-swap on a single Spanner row, done separately from changeset creation. Refs are discouraged except main and release branches. | **Close** for compare-and-swap. How lost races and replays are handled is not described. |
| Server-side query and mutation API (not a STUDY claim) | Not in the 19 files read. Rain says Mononoke had it, without claiming it was new. | Central to Scion: the server does commits, rebases, merges, blame, history, diff and merge-base. | Not checked against Mononoke source. |

The post also describes things that the Mononoke study did not cover: the three cache tiers, a fetch protocol that asks only for wanted objects, and Spanner as the store for refs and derived data. Anthropic's reply says Scion had to solve new problems because it started from a large git repository rather than Mercurial.

## The attribution debate

This section reports what each side published. It does not judge the dispute.

**Timeline** (UTC; HN times from the Firebase API).

| When | What |
|---|---|
| 13 Oct 2026 | Anthropic publishes the post. The prior-art sentence names Google's Piper and Meta's Sapling and says Scion was built with their lessons in mind. Mononoke is not named. |
| 14 Oct, 20:30 | Rain posts "Anthropic's Scion is heavily inspired by Mononoke" (HN 50094694). |
| 15 Oct, 17:05 | Rain posts a follow-up (HN 50106738). |
| 15 Oct, 17:59 | Nick G., the post's author (HN user `nickg-anthropic`), replies on HN (comment 50107559). |
| 15 Oct (per banner); first captured 16 Oct 08:03 | Footnote 2 added, naming Mononoke and the Bonsai data model. |
| After the reply | Rain adds a note to the follow-up: Anthropic has responded, sufficient attribution has been added, and Rain stands by the posts as of the time they were written. |

**Rain's position.** Rain helped build Mononoke at Meta. In the first post they compared Anthropic's paragraph on derived data with their own 2022 description of Mononoke's derived data, written for job-application materials at Oxide. They argued that the resemblance goes well beyond similar insights. They said that crediting Sapling only for lessons, without naming Mononoke, borders on plagiarism. They said they had no objection to the design being copied, only to the missing credit. In the follow-up they said:

- The resemblance covers the whole data model, including Bonsai changesets, and is not limited to derived data.
- Sapling can mean either the client or the whole system, and former members of Meta's source-control team would know the difference.
- They had privately been told that some of the people overlapped and that the copying was intentional. This is Rain's unverified report. This study did not check it.
- The server-side API was not new with Mononoke.

The follow-up also speculates that the name "Scion" plays on "Bonsai". That is Rain's speculation, and Rain marks it as possibly a coincidence.

**Anthropic's response.** Nick G. replied on HN with these points:

- The post credited Sapling because Meta refers to the whole system, including the Mononoke server, by that name.
- A footnote would be added to make this clear, and an edit to the comment says it had been added.
- Scion drew on Mononoke's Bonsai ideas, among other influences. The reply cites Martin Kleppmann's 2015 "Turning the database inside out" as a source for the term "derived data".
- The team did substantial research of its own. They did not simply tell Claude to build a version control system.
- Starting from a large git repository required new work.
- Many former Meta employees at Anthropic took Mononoke as their "north star". The quoted phrase is Anthropic's.

**Secondary coverage.** braindetox.kr (read through a summary) and ai-tldr.dev summarise the first post accurately. They were written before the footnote, and both say that Anthropic had not responded and that Mononoke was not mentioned. Those statements were true when written and are out of date now.

**What stays unresolved.** The two sides agree on the facts: footnote 2 now names Mononoke and Bonsai, and Rain has called that attribution sufficient. They still disagree about how much was copied and whether the first omission was intentional. Rain's account of private information cannot be verified.

## Name clash: Google's Scion

`GoogleCloudPlatform/scion` (Apache-2.0, repository created 10 March 2026) is a different project. Its README describes an open-source platform for orchestrating teams of AI agents. Each agent runs its own coding harness, such as Claude Code or Codex, with per-agent credentials and shared workspaces or separate git worktrees. It is not a version control system. It has no connection to Anthropic's Scion or to Mononoke. In Endoforge documents, "Scion" means Anthropic's version control system unless the text says otherwise.

## What this means for Endoforge

### Edition 2 §10's bottleneck claim is now observed

Edition 2 says the Scion discussion pointed to source control as a potential bottleneck as machine-generated change volume rises [E2 §10]. Anthropic's post reports that this happened. Merges grew twelvefold in four months, and source control became Anthropic's biggest development bottleneck. Several hundred git mirrors were not enough, so Anthropic replaced git. **Upstream.**

This is also outside evidence for Edition 3's second thesis: proposals are cheap now, so the cost moves to the system that turns them into trusted capabilities [E3 §1]. At Anthropic, cheaper code generation moved the bottleneck to source control, builds and CI. **Upstream** for the observation. The connection to the thesis is this study's interpretation.

Two caveats apply. First, this is one company's report about its own unusual workload. Anthropic expects others to meet the problem within six to twelve months, but says few will in the very near term. Second, the report does not show that Endoforge will hit the same wall at its own scale.

### Scale: candidates, not merges

**Derived (illustrative).** 30,000 merges a day ÷ 86,400 s ≈ 0.35 merges a second. Suppose, for illustration only, that each merge stood for one Endoforge request:

- A sixteen-candidate campaign [E3 §10] would produce 0.35 × 16 ≈ 5.6 candidates a second.
- With one repair attempt per candidate (2 attempts each, as in R10), it would produce 0.35 × 16 × 2 ≈ 11 attempts a second.

That is roughly 5 to 11 internal objects a second, at the merge rate that made Anthropic replace git. Mapping one merge to one request is an assumption. The multipliers are R10's illustrative values, not measurements.

**Proposed.** Candidates and attempts must be ledger records, not repository events (R10). The activation compare-and-swap should be the only contended write. This follows the same reasoning as Scion's rule of few refs: global state that every server must agree on is the scaling problem.

### Mapping Scion choices onto Endoforge

All **Proposed**. These choices agree with the R10 requirements and with the Mononoke-derived design. They are a second, independent production example of mechanisms R10 already takes from Mononoke.

| Scion choice | Endoforge counterpart | Reference |
|---|---|---|
| Server-side commits, merges and queries; thin clients | The workpiece never leaves the workcell during generation and repair. Only exact artifacts leave it for qualification. The ledger sits with the controller [E3 §4, §9]. | R10 L6 |
| Few refs; a ref move is a separate compare-and-swap | Candidates and attempts get no named mutable reference. Activation slots are the only named references, and activation is the only contended write. A lost race leaves the candidate inactive. | R10 L5 |
| First-parent changeset plus content-addressed blobs | A candidate is a delta over a private overlay [E3 §4]. Its record names its parent, its changes, its build key and its artifact identity by hash. | R10 L1; R11 |
| Sparse and virtualized checkout; fetch only what is requested | Fetch only the inputs the next step needs. Large inputs stay in host-owned buffers reached through handles [E3 §5]. | R10 L1 |
| Derived data, defined recursively, eager or deferred, internals hidden | Persistent semantic state, such as type facts and test obligations keyed by changeset. Activation gates are always eager. | R07 §1; R10 L1, L3 |
| Post-merge testing instead of a global merge lock | Activation does not depend on a global lock. Conflicting candidates are expected, and losers stay inactive. | R10 L5 |
| Per-directory permissions | Tenant-bound lineage and re-admission on every reuse [E3 §12, §13 risk 4]. | R04; R15 |

### The strongest link: derived data and change-proportional work

Scion's derived data, like Mononoke's before it, is a working production answer to Edition 3's first thesis for version-control history: work proportional to the change, never to the size of the project [E3 §1]. **Upstream** that it works, as reported by Anthropic and as present in Mononoke source. Each index value is computed from the parents' values, so a commit costs as much as its change, and the post states that requirement explicitly.

Endoforge needs the same thing for semantics: type facts, interface facts and test obligations derived per changeset and reused under exact assumptions (R07 §1). **Proposed.** The known gaps are on the Endoforge and Mononoke side:

- Mononoke's default batch derivation is sequential, to avoid O(n²) repeated work (Mononoke STUDY claim (c)). The Scion post does not say how Scion orders derivation.
- No cross-process coalescing of identical derivations was found in the Mononoke files read. This is an open question in the Mononoke study, not a confirmed absence. The Scion post does not address it.
- The tsc-rs WASM interface builds fresh analysis state on every run (R07 §1.1). Warm machinery is not incremental semantics.

### Differences that remain

- **Observations.** Endoforge's ledger must hold observations that cannot be derived again: timings, verdicts and reviewer judgments [E2 §10]. Scion's derived data can be regenerated from changesets. The post describes no equivalent of an observation journal.
- **Trust placement.** Endoforge's ledger sits outside the candidate trust domain. Candidates cannot reach the evaluator, the broker or the ledger [E3 §8]. Scion's clients are Anthropic's own agents and jobs, and the post protects code with access control, not with a separate trust boundary around the record store.
- **Unit.** Scion's unit is a merged code change. Endoforge's hot path is the attempt, and most attempts are scrap that should never become history (R10).

### The ingestion rewrite as an unrecorded qualification

Claude Mythos Preview rewrote the ingestion pipeline with 20x less memory and 4x more speed. Anthropic says the rewrite kept every implicit invariant around ingestion ordering and data structures. **Upstream.** In Endoforge terms this resembles keeper refinement done by hand: a working component rewritten for performance under an unchanged contract [E3 §5]. That reading is an analogy, not something the post states.

The post does not say what oracle showed that the invariants held. Edition 3 §8 makes that oracle the basis of trust. Its example is tsc-rs, which was trusted because it was checked against tests that did not come from the model that wrote it. An Endoforge receipt for the same work would name the oracle and its version, the artifact identity and the environment [E3 §8].

### Attribution and provenance

The attribution debate is a provenance problem. It arose because the lineage of a design was not stated where the work was presented. It was repaired only after publication. Edition 3 names license and provenance as a tracked risk and makes provenance a field from the first admission, not a later audit [E3 §13 risk 6]. Lineage that follows the data is also a mitigation for risk 4. **Proposed** for Endoforge: every admitted candidate, keeper and imported design records its sources at admission, including model output that closely reproduces an identifiable upstream design.

### Positioning

Scion makes the merges that survive cheap. Endoforge aims to reduce how many merges need to exist at all, through qualification before promotion and reuse from the library [E3 §4, §12]. The two complement each other. An Endoforge activation could still end in a repository event on a system like Scion or git. **Proposed.**

### Why Endoforge still builds a small native ledger

- **Not available.** Scion is not released, and Anthropic says a broadly useful public version would be difficult to offer.
- **Wrong scale and purpose.** Scion serves a monorepo of about 100 GB with tens of millions of checkouts a day, and it depends on Spanner and a fleet of cache tiers. Endoforge needs a ledger of candidates, builds, evaluations and activations inside one factory [E2 §10; E3 §9]. Anthropic itself says Scion's ideas make sense only for enormous monorepos.
- **Missing records.** Scion records source. Endoforge must also keep the observation journal, freeze an evaluator identity before evaluation [E3 §6], record evaluation receipts [E3 §8] and track an outcome-unknown state [E3 §9]. Neither Scion nor Mononoke supplies these.
- **What Scion does not show.** Endoforge must still specify closure before publication, scratch expiry and reclamation, and lost-acknowledgment reconciliation. The Mononoke study is the source for the first two, and E2 §10 and E3 §9 cover the third.
- **Edition 2's rule holds.** Endoforge is not a Git replacement [E2 §10]. Like Mononoke, Scion is a source of mechanisms, not a component.

## Edition 3 alignment

- Edition 3 does not mention Scion. This study does not change Edition 3's architecture.
- The fit table above is consistent with Edition 3 §9: the ledger sits outside cohorts with the controller, the three lifetimes apply, and attempt state is discarded.
- Edition 3 §16 states that a hash names bytes and never grants permission. Scion's per-directory permissions are a separate access-control layer, consistent with that rule.

## Limitations

- Every Scion fact comes from Anthropic's own post. There is no code, schema, benchmark or independent measurement.
- The post is a marketing-adjacent engineering post. Figures such as "200x" and "two orders of magnitude" are not given with a method.
- The version history comes from Wayback captures, which are not continuous. The update time is taken from the page banner (15 Oct), and the earliest capture showing the footnote is 16 Oct 08:03 UTC.
- The HN threads were not read beyond story metadata and Anthropic's reply. Rain's embedded screenshots and 2022 materials were not read. Lobsters, Bluesky and LinkedIn were not read.
- The Scion ↔ Mononoke comparison sets a published description beside verified source. Similar wording does not establish similar implementation.

## Open questions

- Does Scion's changeset id hash the record, as Bonsai's does? Does publication of derived data follow closure? Not stated in the post. This cannot be settled without Anthropic publishing more.
- How does Scion handle a lost acknowledgment on a ref compare-and-swap? Not stated. Endoforge's answer does not depend on it (R10 L5).
- Does Scion have anything like bubbles for agent scratch work? Not stated. If it has, it would be the closest production analogue to Endoforge's attempt overlay.
- How does Anthropic's 600 PB/day naive-traffic estimate relate to the number of attempts per accepted change? Not derivable from the post. Endoforge's own multipliers belong to R14's end-to-end campaign.

## Sources

All accessed 2026-10-17.

- Anthropic, "Redesigning source control at Anthropic", <https://www.anthropic.com/engineering/redesigning-source-control> (published 13 Oct 2026, updated 15 Oct). Read in full. **Upstream.**
- Wayback Machine captures of the above: `https://web.archive.org/web/20261013155925/...`, `.../20261015011001/...`, `.../20261016080325/...`; CDX listing `https://web.archive.org/cdx/search/cdx?url=anthropic.com/engineering/redesigning-source-control`.
- Rain (sunshowers), "Anthropic's Scion is heavily inspired by Mononoke", <https://sunshowers.io/posts/anthropic-mononoke/> (2026-10-14). Read in full except images.
- Rain (sunshowers), "More on Anthropic's Scion ripping off Mononoke", <https://sunshowers.io/posts/anthropic-mononoke-2/> (2026-10-15). Read in full except images.
- Hacker News: <https://news.ycombinator.com/item?id=50073633> (post; metadata only), <https://news.ycombinator.com/item?id=50094694> and <https://news.ycombinator.com/item?id=50106738> (critiques; metadata only), <https://news.ycombinator.com/item?id=50107559> (Anthropic's reply; read in full). Retrieved through `hacker-news.firebaseio.com/v0/item/<id>.json`.
- Secondary, cross-checked only: <https://braindetox.kr/en/posts/anthropic_scion_mononoke_derived_data_critique_2026.html>, <https://ai-tldr.dev/releases/sunshowers-scion-mononoke/>, <https://zeli.app/story/50094694> (used only for the HN link).
- Google Scion: <https://github.com/GoogleCloudPlatform/scion> (README and GitHub API metadata).
- `docs/studies/mononoke/STUDY.md` (sapling `79071c2a3ea20c36ed71332608535e5801101bba`).
- [E2 §10], [E2 App. B]; [E3 §1], [E3 §4], [E3 §5], [E3 §6], [E3 §8], [E3 §9], [E3 §10], [E3 §12], [E3 §13], [E3 §16].
- R04, R07, R10, R11, R15 in `docs/reference/`.
