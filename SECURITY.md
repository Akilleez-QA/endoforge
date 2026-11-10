# Security Policy

## Reporting a vulnerability

Do not open a public issue for security problems. Use GitHub's private vulnerability reporting ("Report a vulnerability" under the Security tab) when it is offered. It is not enabled for this repository at the time of writing; if the option is missing, open a minimal issue asking for a private channel, without describing the vulnerability, and wait for that channel.

Include a description, steps to reproduce and the affected commit. We aim to acknowledge reports within 5 business days.

## Supported versions

EndoForge is preproduction and has no release tags.

| Version | Supported |
|---|---|
| Latest `main` | Yes |
| Any earlier commit | No |

## Security posture

- EndoForge runs code that models write. Workcells are V8 isolates, used for speed and concurrency rather than as an
  operating-system sandbox. They cap heap, stack, WebAssembly memory and run time; process workcells can add cgroup
  limits. Thread workcells do not bound memory outside the JavaScript heap.
- Cells have no ambient authority; they reach the supervisor only through bounded host calls. A kernel may import
  nothing except an abort hook.
- Claude Code transports must run on a claude.ai subscription login. API-key and provider configurations are refused,
  and billing variables are removed from child environments. The Codex pool checks only that each account directory
  holds a login file.
- Nothing stores credentials. Tests use synthetic inputs and test doubles.
- CI runs a secret scan in the job `secret-scan` of `.github/workflows/ci.yml`: a checksum-verified Gitleaks 8.28.0 over
  the full history, failing on any finding. See the [software management plan](docs/plan/software-management-plan.md#7-security-privacy-and-secure-coding)
  and the [assurance record](docs/assurance/assurance-record.md).
