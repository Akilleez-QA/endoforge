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

- EndoForge runs model-written code. It runs it in V8 workcells with heap, stack, WebAssembly memory and deadline
  limits, or in forked processes with optional cgroup limits. Thread workcells do not bound off-heap memory.
- Cells have no ambient authority; ports reach the supervisor only through bounded host calls.
- Model clients must use a claude.ai subscription login. API-key and provider configurations are refused, and billing
  variables are removed from child environments.
- Nothing stores credentials. Tests use synthetic inputs and test doubles.
- CI has no secret-scanning job; see the [software management plan](docs/plan/software-management-plan.md#7-security-privacy-and-secure-coding)
  and the [assurance record](docs/assurance/assurance-record.md).
