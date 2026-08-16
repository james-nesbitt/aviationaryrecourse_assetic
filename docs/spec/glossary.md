# Glossary

Terms used across the assetic spec. Defined once here, referenced by short name elsewhere.

## Domain

- **asset** — a physical thing the system tracks: a vehicle, a cargo unit, a passenger manifest, a piece of equipment. Has a master record and a live state.
- **master** — the authoritative, slow-changing record of an asset (ownership, configuration, identity). Stored in Postgres as JSONB. Versioned by `schema_version`.
- **journal** — the append-only, hash-chained sequence of domain events that describe what happened to assets. The source of truth; state is derived from it. Stored in Postgres, partitioned by month, INSERT-only grants.
- **dynamic state** — fast-changing telemetry and operational status (position, speed, door state, current passenger count). Ingested via Redpanda; current value may be cached; durable record lives in the journal or telemetry topics.
- **custody** — the chain of accepted transfers of responsibility for a passenger or cargo item between actors (loading team → on-board staff → receiving team). Recorded as `custody.accepted` / `custody.transferred` events in the hash-chained journal. Doubles as the authorization source for manifest writes.
- **trip / dispatch** — a scheduled movement of a vehicle with assigned cargo and passengers. A dispatch is the authoritative command; a trip is the realized execution.
- **projection** — a read-optimized view derived from the journal/event stream (e.g. "current location of all vehicles", "open custody items for trip X"). Built by a consumer declared via the `Projection` CRD.

## Agents

- **agent class** — a declared, platform-reviewed definition of an AI agent: image, capability ceiling, resource limits, runtime class, egress allowlist. CRD `AgentClass`.
- **agent run** — a single scheduled execution of an agent class on a task, carrying a delegated identity. CRD `AgentRun`.
- **effective privilege (agent)** — `(scheduling role's privileges) ∩ (agent class capabilities) ∩ (task scope)`, enforced outside the agent by the gateway/OPA/Kafka ACLs, never by the agent itself.

## Architecture

- **plane** — a layer of the system with a distinct trust boundary and operational posture:
  - **control plane** — Kubernetes: CRDs, controllers, operators. Reconciles wiring. Low cardinality, high privilege, GitOps-reviewed.
  - **data plane** — Redpanda + Postgres + domain services + stream processors. Handles all domain events and state.
  - **interactive plane** — API gateway + BFFs. Fronts human and client interactions. High cardinality, row/field-level ABAC.
  - **device/edge plane** — EMQX/ChirpStack + on-vehicle and handheld devices. Offline-tolerant; terminates device protocols.
- **front door** — an ingress path with its own identity, privilege, and cardinality profile:
  - **kube API** — low-cardinality, high-privilege, GitOps intent (asset masters partially, sysadmins, platform workflows).
  - **domain API gateway** — high-cardinality, row/field-level ABAC (account managers, loading, on-board, customer-facing reserved).
  - **customer self-service** — reserved, not built this pass.
- **BFF** (backend-for-frontend) — a service that aggregates/reshapes domain API responses for a specific client class. The GraphQL overlay is a BFF.

## Temporal & versioning

- **valid-time** — the wall-clock time at which a domain fact was true in the world (e.g. when a boarding actually happened). Stored on journal rows.
- **transaction-time** — the wall-clock time at which the system recorded the fact. Stored on journal rows. Together with valid-time this makes the journal bitemporal.
- **schema_version** — integer on asset masters and event envelopes; readers handle N versions, writers write newest.
- **support window** — how many prior versions of an app/device the server must support simultaneously. Set to **N-2** (server supports the current and two prior releases). See `data-and-versioning.md`.
- **handoff state** — the lifecycle of a locally-captured transaction on an offline device: `LocalOnly → Submitted → Committed | Rejected`. See `data-and-versioning.md`.

## Security

- **ABAC** — attribute-based access control: authorization decisions use relationship attributes (customer relationship, current shift + assigned trip, active assignment) rather than static roles. The domain access model.
- **RBAC** — role-based access control: used only for the operator/asset-manager and platform/infra tier (kube RBAC).
- **on-behalf-of (OBO)** — OAuth2 token exchange (RFC 8693): a scheduler exchanges its token for a short-lived, down-scoped token carrying an `act` claim naming the agent run. The agent never holds the scheduler's full rights.
- **envelope encryption** — PII payloads are encrypted with a data key; the data key is wrapped by a KMS/Vault master key. Platform/sysadmin roles cannot unwrap the master key (structural separation).
- **capability handle** — a pre-authorized, scoped reference an agent receives instead of a raw credential (e.g. "you may write to topic X", not "here is the Kafka SASL string"). Enforced at the gateway/broker.