# Security policy

A Data System of Record stands between AI agents and systems that move money, change
access, and hold confidential data. Treat issues involving the following as
particularly important: cross-tenant access, delegation or privilege escalation,
approval bypass or forgery, segregation-of-duties bypass, duplicate execution,
an unknown outcome reported as success or failure, audit tampering or loss,
prompt injection that changes an authorization outcome, connector credential
exposure, classified data reaching a model boundary it should not, and anything that
lets a control fail open.

## Reporting

Report vulnerabilities privately via
[GitHub Security Advisories](https://github.com/panaversity/dsor/security/advisories/new).
Do not open public issues for security reports.

Please include the affected version or commit, a reproduction, and the impact as you
understand it. You will get an acknowledgement within 72 hours.

## Scope notes

- The repository is pre-release. Today it contains a specification, JSON Schemas, and
  tests; the reference implementation has not been started (`docs/status.md`). A flaw
  in the **specification** that would let a conforming implementation be unsafe is in
  scope and welcome: name the requirement ids involved.
- Supply-chain reports about this repository's dependencies are in scope. The repo
  enforces a 48-hour release quarantine (`minimumReleaseAge`) and denies dependency
  install scripts by default.
