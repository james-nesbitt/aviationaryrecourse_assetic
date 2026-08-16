# assetic specification

Status: **draft**

assetic is a high-assurance, high-security system for managing high-transportation vehicles, cargo, passengers, and dispatches. This directory is the authoritative specification. Each file is self-contained and decision-complete for its concern; an implementer (human or AI agent) should need nothing beyond a file and its explicitly cross-referenced siblings to build that concern.

## Architectural invariant

> Kubernetes controllers reconcile infrastructure and wiring from Custom Resources; all domain events flow through Redpanda and are handled by services. No domain state, no per-event objects, in the kube API.

Everything else in this spec follows from that one line. The kube API is a coordination surface for low-cardinality intent; Redpanda is the event spine; Postgres is the system of record.

## Resolved decisions

| Decision | Value | Where elaborated |
|---|---|---|
| System name | `assetic` | — |
| CRD group root | `assetic.io` | `cloud-components.md` §1 |
| Namespace root | `assetic-system` | `cloud-components.md` §1 |
| Interactive API style | REST (OpenAPI 3.1) client-facing + gRPC service-to-service + optional GraphQL overlay BFF for read-side dashboards | `cloud-components.md` §4 |
| Event backbone | Redpanda (Kafka API-compatible, no JVM/ZooKeeper) | `cloud-components.md` §2 |
| System of record | PostgreSQL (JSONB masters, hash-chained journal, state tables) | `cloud-components.md` §3 |
| Domain policy engine | OPA (default; Cedar is an open decision) | `cloud-components.md` §7, `open-decisions.md` |
| Device gateway | EMQX (MQTT) + ChirpStack (LoRaWAN) | `cloud-components.md` §5 |
| Agent LLM gateway | chokepoint service, no secrets in prompts | `cloud-components.md` §6 |
| Spec structure | multi-file, one file per concern | this file |

## Files

| File | Concern |
|---|---|
| `README.md` | this index |
| `glossary.md` | shared terms |
| `overview.md` | planes, boundaries, technology summary |
| `cloud-components.md` | detailed cloud-side component definitions (primary) |
| `data-and-versioning.md` | data handling, versioning policy, offline handoff |
| `personas-and-access.md` | personas, ABAC model, access matrix, agent action tiers |
| `engineering-model.md` | environment tiers, testing ladder, local stacks, prod posture |
| `open-decisions.md` | decisions register with defaults and blockers |

## Not yet written (future passes)

The following are out of scope for the cloud-components pass but are kept coherent by the decisions here:

- `device-edge.md` — device/edge gateway internals, offline capture, custody on device.
- `ui-clients.md` — web/mobile client architecture, offline sync protocol.
- `ai-agents.md` — agent scheduling, containment, approval gates (cloud-side hooks defined in `cloud-components.md` §6 and `personas-and-access.md`).
- `security.md` — threat model, PII envelope encryption, audit anchoring, SIEM integration.
- `observability.md` — metrics, tracing, logging, run telemetry.
- `operations.md` — GitOps, upgrade, backup/restore, runbooks.
- `customer-gateway.md` — third front door (reserved, not built).