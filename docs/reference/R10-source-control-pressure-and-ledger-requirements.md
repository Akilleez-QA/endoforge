# R10 Source-control pressure and ledger requirements

> Reconstructed 2026-10-17. The original R10 was not available; this version is rebuilt from
> Edition 2 §3, §7, §10 and Appendix B, Edition 3 §9, §10, §16 and §18, and a fresh Mononoke source
> study (`docs/studies/mononoke/`). Content follows Edition 3 where the editions differ.

## Purpose

Explain why Endoforge needs an experiment ledger of its own, and what that ledger must do. Edition 2 traces the need to a discussion of Scion, which framed source-control infrastructure as a likely bottleneck once machines generate most changes. This document states that motivation without adding facts about Scion that cannot be checked here, shows why each internal experiment cannot be a full repository event, and lists the requirements R11 must meet.

## Summary

- Edition 2 records that the Scion discussion pointed at source control as a potential bottleneck when machine-generated change volume rises [E2 §10]. Scion is now identified: it is Anthropic's in-house version control system, it is not released, and Anthropic reports that the bottleneck occurred at its own scale. **Upstream** (`docs/studies/scion/STUDY.md`).
- A factory that tries several candidates per request, each with builds, evaluations and repairs, produces far more internal objects than accepted changes. Making each one a commit, push, review and CI run would put the slowest, most durable machinery on the hottest path. **Proposed** reasoning; the per-event cost has not been measured.
- The ledger must make alternatives cheap, keep every promotion accountable, avoid repeating identical work, and refuse to publish scratch objects durably by default. **Proposed.**
- The ledger supports production. Endoforge is not a Git replacement and does not embed Mononoke [E2 §10].
- R11 gives the design; the Mononoke study grounds its mechanisms.

## The Scion motivation

What Edition 2 states:

- "The Scion discussion" focused attention on source-control infrastructure as a potential bottleneck as machine-generated change volume rises. A Mononoke source study followed and supplied mechanisms [E2 §10].
- Edition 2 says it does not newly verify Scion availability [E2 App. B].
- Edition 3 does not mention Scion. It carries the Mononoke study forward as a source [E3 §18].

What the primary source now establishes (`docs/studies/scion/STUDY.md`, read 2026-10-17). All of it is **Upstream**: it is Anthropic's own report, from "Redesigning source control at Anthropic", anthropic.com/engineering, published 13 Oct 2026 and updated 15 Oct. None of it was measured here.

- **What it is and who maintains it.** Scion is Anthropic's in-house version control system for its monorepo. A team of seven at Anthropic built it and migrated the monorepo from git in five months.
- **Availability.** Scion is not released. Anthropic says it is not a general git replacement and would be difficult to offer in a broadly useful form, and it plans to share ideas instead.
- **The pressure.** Merges rose from about 2,500 a day in May 2026 to over 30,000 a day in September. Main-branch history is almost 100 GB, and a compressed working copy is over 25 GB. At peak Anthropic ran several hundred git mirrors. Anthropic reports that source control became its biggest development bottleneck.
- **Architecture.** Clients are always online, and the server performs commits, rebases, merges and history queries. A changeset stores the files changed against its first parent, with content-addressed pointers to blobs. Blame, history and graph indexes are derived data, built recursively from parent values, eagerly or on demand. Checkouts are sparse or virtualized. Refs are discouraged except main and release branches, and a ref move is a compare-and-swap on one row. Scion also supports per-directory permissions.
- **Throughput figures.** Compared with the previous git mirroring, Scion uses 200x less CPU and memory, and checkouts are two orders of magnitude faster.
- **Lineage.** After a public attribution critique, a 15 Oct footnote states that Mononoke pioneered many of Scion's techniques, especially the Bonsai data model. The study maps Scion's published design onto the verified Mononoke mechanisms.
- **Name clash.** Google has an unrelated project also called Scion, for orchestrating AI agents.

The ledger argument does not depend on any Scion detail. The pressure comes from Endoforge's own design: proposals are cheap, so the surrounding system exists to turn many cheap proposals into a few trusted capabilities [E3 §1]. Whatever records those proposals sees the full proposal volume, not just the accepted volume. Scion is outside evidence that this pressure is real at one company's scale. It is not a measurement of Endoforge.

## Why every experiment cannot be a repository event

### The volume is in the attempts, not the acceptances

Edition 3 describes four parallel candidates as the normal novel-request case, and sixteen as a possible yield purchase [E3 §10]. Each candidate may produce a resolved source, a build, an artifact, one or more evaluation attempts, and repair rounds. Most of it is scrap.

**Derived (illustrative).** With 4 candidates per request and, say, 2 attempts each (one initial run, one repair), a request produces 8 build-and-evaluate attempts, and usually one accepted capability. A sixteen-candidate campaign produces 32 or more. The ratio of internal objects to accepted changes is therefore around an order of magnitude or more. These multipliers are assumptions chosen to show the shape; they are not measured.

### A repository event costs more than the attempt it records

A full repository event usually means a durable commit object, a reference update, replication, hooks, and often review and CI. Those exist to make a change shared, durable and reviewable. An attempt needs none of that: Edition 3 makes attempt state fresh per candidate, discarded after bounded execution, with outputs published only after validation [E3 §9].

Edition 3 estimates the engineered stages (compiler, module instance, local tests) at one to three seconds per request [E3 §10]. **Proposed:** any per-attempt bookkeeping must be small next to that. The cost of a repository event on this machine has not been measured. E3 X1–X6 do not measure it either; see open questions.

### What goes wrong if every attempt is a commit

| Problem | Why it matters |
|---|---|
| Durable publication of scrap | Every failed candidate becomes permanent history and storage. Discarding a name later does not free the bytes [E2 §3]. |
| Wrong unit of identity | A commit conflates proposal, source, build and result. Two proposals that share a build look like two builds; one build evaluated twice looks like one result [E2 §10]. |
| Contention on shared references | Many attempts updating one branch race. A lost race must not look like success or like nothing happened [E2 §10]. |
| Review and CI cost on the hot path | Machinery built for people reviewing changes runs once per attempt instead of once per promotion. |
| Lost observations | A commit records source, not the fact that one run took a given time on one machine. Observations need their own journal [E2 §10]. |

The accepted capability, its evidence, and its activation can still become a repository event. The rule is about attempts, not about never using source control.

## Requirements the ledger must meet

All requirements are **Proposed**. Each names the Mononoke mechanism that shows it is buildable (see `docs/studies/mononoke/STUDY.md`) or the Edition 3 rule it serves.

### L1 Cheap alternatives

- Creating a candidate writes a small record that points at content by hash. It does not copy the project. (Mononoke: Bonsai records hold paths→content ids, contents stored separately; STUDY claim (a).)
- Attempt state lives in an overlay that reads through to the shared warm base and writes only to itself. (Mononoke: ephemeral bubbles; claim (d). Edition 3 attempt lifetime [E3 §9].)
- Representations are produced only when the next step needs them; activation gates are always in that closure. (Mononoke: derive on demand; claim (b). [E2 §10].)
- Large indexes load by key, not wholesale. (Mononoke: sharded maps; claim (e).)

### L2 Accountability

- Every promotion and activation names exactly which candidate, source, build key, artifact, evaluator hash and evaluation attempts it rests on.
- The evaluator's hash enters the ledger before evaluation begins [E3 §6].
- Each evaluation produces a receipt with the POODO precommit fields: observable, acceptance boundary, oracle and oracle version, artifact identity, environment, failure meaning, stop condition [E3 §8].
- Delivery state and outcome state are kept apart and enforced by deterministic code [E3 §8].
- Observations go in an append-only journal with their scope. They are never treated as a regenerable cache [E2 §10].
- A hash names bytes. It never grants permission or proves correctness [E2 §10; E3 §16].

### L3 No duplicate work

- Identical derivations are keyed by a build key covering every build-affecting input, including configuration, source restrictions and trust scope. Compatible callers join one in-flight derivation [E2 §7].
- Batch derivation over dependent inputs must not recurse concurrently in a way that repeats work. (Mononoke: the default batch path is sequential for this reason; claim (c).)
- An identity match is not permission. Coalescing never shares mutable state across trust scopes [E2 §7].

### L4 No durable publication of every scratch object

- Scratch has an owner, an expiry and an explicit retain flag. Expired, unretained scratch is reclaimed. (Mononoke: bubble expiry, grace and labels; claim (d).)
- Publication follows closure: no durable reference points at an object that is not itself durable [E3 §9]. (Mononoke: derived blobs are flushed before the mapping is written; STUDY §3.)
- Reclamation is measured in bytes, not names. Unlinking, releasing and freeing are distinct recorded states [E2 §3]. (Mononoke: the in-memory test store unlinks names without freeing payloads; claim (g).)

### L5 Safe activation under failure

- Activation is a conditional update against the expected previous activation. A lost race does not activate the candidate. (Mononoke: bookmark compare-and-swap; claim (f).)
- A lost acknowledgment is reconciled against the authoritative activation record, not inferred from the compare-and-swap result [E2 §10]. (Mononoke: replay detection by already-advanced log id; STUDY additional finding.)
- An attempt interrupted after authorization is in an outcome-unknown state until reconciled [E3 §9].

### L6 Placement

- The ledger sits outside every isolate cohort, with the controller, so a process loss loses attempts and never the task [E3 §9].
- The ledger is small and Endoforge-native. It does not embed Mononoke or its dependency closure [E2 §10].

## Edition 3 alignment

- **Holds:** the ledger supports production and sits outside the centre of the design [E2 §10]. Edition 3 makes this more specific by placing it outside every cohort [E3 §9].
- **Added by Edition 3:** the frozen evaluator hash in the ledger before evaluation [E3 §6]; POODO precommit fields as the evaluation receipt and delivery/outcome separation enforced in the ledger [E3 §8]; the three lifetimes and outcome-unknown as a state [E3 §9]. These appear above as L2 and L5.
- **Changed:** Edition 3 replaces the QuickJS guest and per-candidate virtual filesystem with a WebAssembly module instance [E3 §9]. The overlay requirement (L1) now applies to a module instance's inputs and outputs rather than to a guest filesystem.
- **Not carried forward:** Edition 3 does not mention Scion. This document keeps the Scion motivation only as the historical reason the ledger was studied.

## Open questions

- Scion's identity, availability and published design are now established from the primary source (`docs/studies/scion/STUDY.md`). Anthropic's figures are self-reported and cannot be checked independently. The post does not say how Scion handles a lost acknowledgment on a ref compare-and-swap, whether derived data is published only after closure, or whether Scion has scratch storage like bubbles. Record the post as an R18 source-register entry with its access date. Revalidate it before relying on figures that may change.
- What does one repository event (commit, ref update, hooks) cost on the target hosts, next to one attempt? Not measured. Belongs in R14's measurement programme as a baseline next to E3 X1–X6, or in a dedicated work package.
- What are real candidate and attempt multipliers per request? The figures above are illustrative. The matched end-to-end campaign in R14 would record them.
- At what volume does the ledger itself need sharded indexes? Depends on the multipliers above.

## Sources

- [E2 §3] "Scrap and reclamation"; [E2 §7] "Coalesce dependencies instead of multiplying them"; [E2 §10] "The ledger belongs inside the factory, not at its center"; [E2 App. B] entries M and R01–R18.
- [E3 §1], [E3 §6], [E3 §8], [E3 §9], [E3 §10], [E3 §16], [E3 §18].
- `docs/studies/mononoke/STUDY.md` and `SOURCE-MAP.md` (`facebook/sapling` at `79071c2a3ea20c36ed71332608535e5801101bba`).
- `docs/studies/scion/STUDY.md` (Anthropic, "Redesigning source control at Anthropic", accessed 2026-10-17).
