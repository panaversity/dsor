---
status: draft
version: 1.3.1
date: 2026-09-19
part: appendix-b-cel
---

# Appendix B — CEL environment

Expressions are CEL. Function names are flat (`dsor_exceeds`, not `dsor.exceeds`) because not every CEL implementation supports namespaced extension functions, and portability across implementations matters more here than style.

| Variable | Type | Content |
|---|---|---|
| `input` | map | The validated, canonical operation input |
| `state` | map | Bound resources by the aliases in the contract's `bind`, read at the contract's freshness |
| `principal` | map | Subject id, type, and current roles in the active tenant |
| `actor_chain` | list | Actor ids |
| `delegation` | map | The active delegation, or null |
| `tenant` | map | Tenant id and policy |
| `risk` | string | The operation's risk level |
| `now` | timestamp | Decision time from DSoR's trusted clock |

| Function | Meaning |
|---|---|
| `dsor_money(value, currency)` | Constructs a `money` value from a decimal string and an ISO 4217 code |
| `dsor_exceeds(a, b)` | `a > b`, after converting `a` to `b`'s currency |
| `dsor_covers(a, b)` | `a >= b`, after converting `b` to `a`'s currency |
| `dsor_sum(list)` | Sum of `money` values in the tenant's control currency |
| `dsor_in_flight(uri)` | Total `money` committed to in-flight proposals over a resource |
| `dsor_is_new_counterparty(uri, duration)` | True when the counterparty, or its payment details, first appeared within the duration |

Conversion uses the tenant's rate source. A conversion that cannot be performed raises an evaluation error, which DSOR-CTL-07, DSOR-CTL-08, and DSOR-MON-04 resolve restrictively. The `agent_asserted` block is never part of the environment (DSOR-AUD-07).

The schema package includes a test that runs the `high-value-payment` control's vectors through a CEL evaluator: 25,000.00 USD is allowed; 25,000.01 USD, 50,000,000 PKR, and an unconvertible currency all require approval; and the earlier style of condition, `amount > 25000 && currency == "USD"`, is shown to allow the 50,000,000 PKR payment.
