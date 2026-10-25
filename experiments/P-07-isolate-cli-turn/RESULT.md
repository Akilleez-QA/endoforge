# P-07 isolate-cli-turn — RESULT

**Status: complete, 2026-10-17 (late evening).** Label for every number: **Recorded (probe)**; one shared desktop, one run per arm, no replication.

**Question.** Can a model turn run *inside* an OS isolate (bubblewrap 0.12.0) that holds only a minimal home with the user's own subscription credentials and the mounts an atom declares, so that the isolate boundary can serve as the atom boundary of the task atomizer?

**Setup.** `bwrap` with read-only system binds (`/usr`, `/lib`, `/lib64`, `/bin`, `/sbin`, `/etc/ssl`, `/etc/ca-certificates`, `/etc/resolv.conf`, `/etc/hosts`, `/etc/passwd`, `/etc/group`, `/etc/localtime`), a fresh private home bound at `/home/user` containing only `.claude/.credentials.json`, `.claude.json`, `.codex/auth.json`, `.codex/config.toml` (copied, mode 600, deleted after), the mise install trees for `claude` 2.1.299, `codex` 0.162.1 and `node` 26.8.1 read-only, one work directory bound at `/work` holding `hello.txt` with a nonce, `tmpfs /tmp`, `--unshare-pid --unshare-uts --unshare-ipc --unshare-cgroup-try --die-with-parent --new-session --clearenv`, network kept (the model is remote). No `CLAUDE.md`/`AGENTS.md` reachable.

| Arm | Command | Exit | Wall | Observed |
|---|---|---|---|---|
| overhead | `bwrap … -- true` | 0 | 7 ms | sandbox start cost |
| boundary (no model) | `ls /home/user/Work; cat /work/hello.txt` | 0 | — | `No such file or directory`; nonce printed |
| A tool-less Claude | `claude -p --output-format json --no-session-persistence --tools "" --strict-mcp-config --mcp-config '{"mcpServers":{}}' --disable-slash-commands --no-chrome --setting-sources "" --max-budget-usd 1 --model claude-sonnet-5-5`, prompt on stdin | 0 | 2,837 ms | result `ok`; model `claude-sonnet-5-5`; usage in 2 / out 4, cache read 535, cache creation 1,864 |
| B tool-using Claude | same with `--tools Bash --permission-mode bypassPermissions`; asked to `cat /work/hello.txt` and `ls /home/user/Work` | 0 | 4,134 ms | nonce reported verbatim; `ls: cannot access '/home/user/Work': No such file or directory`; out 277 tokens |
| C Codex, own sandbox nested | `codex exec -s read-only --skip-git-repo-check --ephemeral --json -o /work/C.txt` | 0 | 7,499 ms | last message `ok`; usage in 14,203 (12,288 cached) / out 5; Landlock+seccomp inside bwrap worked |

**What the isolate wrote into its private home:** `.claude.json` (and a backup under `.claude/backups/`), Codex sqlite state and caches. All inside the per-run home, which is discarded; nothing reached the real home.

**Conclusions (within this scope).** (1) Authentication works from a copied credential file alone; no keyring access is needed inside the isolate. (2) A tool-using agent inside the isolate sees exactly the declared mounts: the boundary is enforced, not instructed. (3) Codex's own read-only sandbox nests inside bubblewrap without the bypass flag. (4) Startup overhead is three orders of magnitude below a model turn. **Not shown:** behaviour under concurrency (dozens of isolates sharing one login), rate-limit behaviour, or any run longer than seconds. Receipts: `receipt/A.json`, `B.json`, `C.jsonl`, `C-last-message.txt`, the stderr files. The credential copies were deleted with the probe directory.
