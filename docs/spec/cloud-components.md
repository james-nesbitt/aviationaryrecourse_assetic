# Cloud components

This file is the primary deliverable of the cloud-components spec pass. Each component is specified with: responsibility, interfaces, dependencies, failure mode, and local (laptop) form. An implementer builds from these sections directly.

Cross-references: `overview.md` (planes, boundaries), `data-and-versioning.md` (versioning, journal, handoff), `personas-and-access.md` (ABAC, agent tiers), `open-decisions.md` (defaults).

---

## 1. Kubernetes control plane

### Responsibility

Reconcile infrastructure and wiring from Custom Resources. Controllers materialize CRs into Deployments, Redpanda topics/users, EMQX auth/ACL, gateway routes, KEDA scalers, and policy bundles. Controllers never handle domain events; they react to CR changes and status reports only.

### Distribution posture

- **Local**: kind or k3d (single node).
- **Dev**: small managed or self-managed cluster, multi-namespace.
- **Staging/prod**: HA control plane, multi-AZ etcd, 3+ control-plane nodes.

Standard upstream Kubernetes; no managed-specific CRD dependencies. KRaft-mode is not applicable (that is a Kafka/Redpanda concept).

### CRDs

Group root: `assetic.io`. API version: `v1` from day one. All CRDs ship with conversion webhooks so `v1` → `v2` is a supported path without breaking existing resources.

All CRDs are **Namespaced** (not Cluster-scoped) unless noted. This keeps per-tenant isolation natural and lets staging/dev mirror prod namespaces.

| CRD | Group/Version | Scope | Purpose |
|---|---|---|---|
| `AgentClass` | `assetic.io/v1` | Namespaced | Declares an AI agent: image, capability ceiling (which APIs/topics/tools), resource limits, runtime class, egress allowlist, max token scope, whether output requires human approval. Platform-team-reviewed. |
| `AgentRun` | `assetic.io/v1` | Namespaced | A single scheduled execution of an agent class on a task. Carries the delegated identity reference, task scope, deadline. Controller materializes into a Job with a per-run ServiceAccount. |
| `IntegrationEndpoint` | `assetic.io/v1` | Namespaced | Registers a client/partner system. Controller materializes into gateway routes, OIDC client config, rate limits, Redpanda `KafkaUser` + prefix ACLs. |
| `DeviceClass` | `assetic.io/v1` | Namespaced | Declares a device/scanner type. Controller materializes into EMQX auth/ACL entries, schema registration, bridge rule → Redpanda topic. |
| `Projection` | `assetic.io/v1` | Namespaced | Declares a read-model/consumer. Controller materializes into a consumer Deployment, consumer group, optional sink connector, cache warming. |
| `EventResponder` | `assetic.io/v1` | Namespaced | Declares "when event X → run consumer Z." Controller materializes into a consumer Deployment + KEDA `ScaledObject` scaling on Redpanda consumer lag. |
| `PolicyBundle` | `assetic.io/v1` | Namespaced | OPA/Cedar policy distribution. Versioned rollout; controller pushes bundle to OPA sidecars/gateway. |
| `TenantOnboarding` | `assetic.io/v1` | Namespaced | Composite: onboards a tenant (namespace, base CRs, quotas, network policies). |
| `RegionRollout` | `assetic.io/v1` | Namespaced | Composite: rolls a stack version into a region with progressive canary. |

### Status conditions convention

Every controller reports status conditions on its CRs using the standard `conditions` array with two fixed types:

- `Ready` — the reconciled resource is functional.
- `Degraded` — partially functional or reconciling; `reason` and `message` carry detail.

Controllers must set `Ready=False` with a reason within 30s of detecting a problem; they must not silently leave stale `Ready=True`.

### Dependencies

- cert-manager (for webhook TLS and per-component mTLS cert issuance).
- A Redpanda operator or Helm chart providing `KafkaTopic`/`KafkaUser`-style CRs (see §2). If the Redpanda operator lacks CR coverage at implementation time, fall back to the Strimzi CRD surface against a Redpanda cluster (Kafka API compatibility) and note the substitution in §2.
- KEDA (for `EventResponder` scaling).
- An ingress controller (Envoy or Istio — open decision, default Envoy for simplicity).

### Failure mode

- Controller crash → leader election re-elects, reconciles from CR state. No data loss (CRs are the desired state; materialized resources are reconciled).
- Webhook unavailable → CR validation/mutation blocked; controllers degrade to last-known-good. Webhooks must have a failure policy of `Fail` for validation (reject invalid intent) and `Ignore` for mutation (do not block creation if webhook is down).

### Local form

kind cluster with cert-manager, KEDA, and a single-node Redpanda chart. Controllers run via `make run` against the kind kubeconfig. CRDs installed via `make install` (kustomize).

---

## 2. Redpanda event backbone

### Responsibility

Durable ingest-of-record, fan-out decoupling, replay, log compaction for current-state topics, command topics for dynamic operations. The spine that everything else hangs on.

### Management surface

Topics and users are declared in Git as `KafkaTopic` / `KafkaUser` CRs (operator-managed). The operator reconciles them against the Redpanda cluster. No manual topic creation in any environment.

**Contingency**: if the Redpanda operator does not provide `KafkaTopic`/`KafkaUser` CRs at implementation time, use the Strimzi CRD surface (`KafkaTopic`, `KafkaUser`) against the Redpanda cluster. Redpanda implements the Kafka API; Strimzi CRs work against any Kafka-compatible broker. Note the substitution here in the same change that introduces the dependency.

### Topic taxonomy

All topics keyed by `vehicle_id` for per-vehicle ordering, except where noted.

| Topic | Key | Purpose | PII | Retention |
|---|---|---|---|---|
| `telemetry.position` | `vehicle_id` | GPS/position reports | no (vehicle ID is pseudonymous) | tiered → S3 |
| `telemetry.passenger` | `vehicle_id` | current passenger count/state | pseudonymized | tiered → S3 |
| `telemetry.cargo` | `vehicle_id` | cargo sensor state | no | tiered → S3 |
| `events.boarding` | `vehicle_id` | boarding events (pseudonymized payload) | pseudonymized | 90d + tiered |
| `events.boarding.pii` | `vehicle_id` | PII payload for boarding (envelope-encrypted) | yes — restricted ACL | 30d, then delete |
| `events.loading` | `vehicle_id` | loading events | no | 90d |
| `events.custody` | `custody_id` | custody accept/transfer (hash-chained) | pseudonymized | indefinite (audit) |
| `events.departure` | `vehicle_id` | departure events | no | 90d |
| `events.arrival` | `vehicle_id` | arrival events | no | 90d |
| `events.approval` | `approval_id` | approval proposals and decisions | pseudonymized | indefinite (audit) |
| `events.payment` | `payment_id` | payment events (exactly-once) | envelope-encrypted | 7y (regulatory) |
| `commands.dispatch` | `vehicle_id` | current dispatch command intent (compacted) | no | compacted |
| `commands.<vehicle>` | `vehicle_id` | per-vehicle command/response (compacted) | no | compacted |
| `agents.runs` | `run_id` | agent run lifecycle | pseudonymized | 90d |
| `agents.actions` | `run_id` | agent action log (hash-chained) | pseudonymized | indefinite (audit) |
| `agents.tokens` | `run_id` | token exchange records (metadata only, no token values) | no | 90d |

**PII split rule**: any topic carrying PII is split into a pseudonymized public topic and a `.pii` topic with envelope-encrypted payload and a restricted ACL. The `.pii` topic has a shorter retention and is deleted, not archived, at expiry.

### Schema Registry

Redpanda's built-in Schema Registry, Avro format. Compatibility enforced at **`BACKWARD_TRANSITIVE`** minimum (new consumers can read all old event versions; required for replay). A breaking change requires a new subject version and a migration window — never an in-place schema replacement.

Subjects: `<topic>-value` per topic. Key schemas use `string` (vehicle_id etc.) unless a composite key is needed.

### Partition guidance

- Hot topics (`telemetry.*`, `events.*`): 50–100 partitions. Key by `vehicle_id` for per-vehicle ordering.
- Audit topics (`events.custody`, `events.approval`, `agents.actions`): 12–24 partitions; keyed by entity ID.
- Command topics: 1 partition per vehicle (compaction requires single-partition-per-key semantics — use a compacted topic with `vehicle_id` key and enough partitions to avoid hot keys; if strict per-vehicle ordering of commands is needed, use `commands.<vehicle>` per-vehicle topics provisioned dynamically).

Small-message batching at the bridge (EMQX) to reduce broker load.

### Security

- **Service authentication**: mTLS per service principal; certs via cert-manager, rotated by the operator.
- **Human/admin authentication**: SCRAM-SHA-512 or OAuth (OIDC token exchange) — prefer OAuth for humans to avoid shared secrets.
- **Authorization**: per-topic prefix ACLs. `allow.everyone.if.no.acl.found=false` (default deny). ACLs are declared via `KafkaUser` CRs and reconciled by the operator. No console/CLI ACL grants in any environment.
- **Quotas**: per-principal produce/fetch rate limits and request-rate quotas; declared in `KafkaUser` CRs.
- **PII encryption**: envelope encryption of PII payloads (data key per event or per batch; data key wrapped by Vault/KMS master key). Broker never sees plaintext PII.
- **Authorizer logging**: allow/deny decisions logged to SIEM (via a Redpanda audit log or a sidecar). Unverified — confirm Redpanda audit logging capability meets SIEM integration needs before relying on it.

### Tiered storage

Long telemetry retention to S3 (or S3-compatible). Configured via Redpanda tiered storage; retention policies per topic (see table above).

### Local form

Single-node Redpanda container (`docker.redpanda.com/redpandadata/redpanda`), single broker, KRaft mode, schema registry enabled. One container, no ZooKeeper, no JVM. Developers run it via the repo's `stack.yaml` (compose) or Testcontainers.

### Failure mode

- Broker loss → partition leader failover (replicas ≥ 3 in prod, RF=1 locally). No data loss for acked writes (`acks=all` in prod).
- Consumer lag → monitored; KEDA scales consumers for `EventResponder`-backed workloads.
- Unacked writes (device offline or gateway down) → remain on-device (offline handoff) or in EMQX persistence (queued messages). No silent loss.

---

## 3. PostgreSQL data tier

### Responsibility

System of record. Three workload shapes in one engine:

1. **Asset masters** — JSONB columns with GIN indexes. Slow-changing. `schema_version` field on every master.
2. **Append-only journal** — partitioned by month. INSERT-only grants (no UPDATE/DELETE to the application role). Hash-chained rows for custody/approval/payment events. Each chained row includes `prev_hash` (hash of the predecessor row in the same chain) and `row_hash` (hash of this row's content + `prev_hash`).
3. **Current-state tables** — relational projections of the journal for fast reads. Derivable from the journal; **the journal wins on disagreement**.

### Bitemporal columns

Every journal row carries `valid_time` (when the fact was true in the world) and `transaction_time` (when the system recorded it). This makes the journal bitemporal without a dedicated bitemporal engine. Default: Postgres with these columns; XTDB is an open decision if audit/regulatory query patterns demand a native bitemporal store.

### Schema versioning

Asset masters carry an integer `schema_version`. Readers handle N versions (code branches on `schema_version`); writers write the newest version. Migration is additive (new optional fields) until a breaking change requires a new version and a reader update.

### CDC

Debezium reads the Postgres WAL and streams changes to Redpanda. This is the only path from Postgres to Redpanda — no application-level dual-writes. State tables are derived from the journal; if a state table disagrees with the journal, the journal is authoritative and the state table is rebuilt.

### Journal integrity

- Hash chaining on custody, approval, and payment events: each row's `row_hash` includes the `prev_hash`, forming a chain. Tampering with any row breaks the chain.
- Periodic external anchoring: the latest chain head hash is periodically published to an external tamper-evident log (details in `security.md` — not written this pass). Default: anchor to a hash column in a separate, append-only audit table plus a periodic snapshot to object storage.

### Dependencies

- Postgres 16+ (for partitioning and JSONB performance).
- Debezium connector (deployed as a connector in Redpanda's Kafka Connect or as a standalone Debezium Server).
- pgcrypto or application-level hashing for `row_hash`/`prev_hash`.

### Failure mode

- Primary loss → replica promote (sync replicas in prod; `synchronous_commit=on` for custody/approval/payment writes).
- Backup/restore and journal-replay drills are scheduled exercises in prod (see `engineering-model.md`). Restore = restore backup + replay journal from backup point to now.

### Local form

Single Postgres container. Testcontainers for functional tests (schema migration applied, seed data loaded, torn down per test class).

---

## 4. Domain API gateway + BFFs

### Responsibility

Front interactive clients. Terminate OIDC. Enforce ABAC via OPA. Apply rate limits. Request/response only — no business logic in the gateway.

### Contracts

- **Client-facing**: REST, OpenAPI 3.1. Versioned `/v1/`. Additive changes within a version; deprecation via `Sunset` header + changelog. Generated clients per language from the OpenAPI spec.
- **Service-to-service**: gRPC, protobuf. Generated stubs. Same contract-first discipline.
- **GraphQL overlay BFF**: read-side aggregation for admin dashboards only. Sits over the REST/gRPC contracts; does not own a contract. Field-level ABAC is enforced at the underlying REST/gRPC layer; GraphQL must not bypass it (the BFF passes through the caller's token; the underlying service re-evaluates ABAC). The BFF may not issue its own credentials or hold elevated privileges.

### Gateway topology

One shared API gateway with per-class routes (web, mobile, agent, partner). A separate customer-facing front door is reserved (not built this pass). If the customer door is introduced, evaluate splitting the gateway at that point (open decision — `open-decisions.md` entry 2).

### Real-time push

SSE from a projection service that consumes Redpanda. WebSocket only if bidirectional push is needed (flagged, not mandated — `open-decisions.md` does not list this as blocking; decide when a concrete bidirectional requirement appears).

### Dependencies

- OPA (or Cedar) sidecar or remote service for ABAC decisions.
- OIDC IdP: Keycloak locally; production IdP default Keycloak (must support OIDC + token exchange; if org standardizes on a different IdP, swap and update `open-decisions.md` entry 8).
- Redpanda (for SSE projection consumers).
- Ingress: Envoy (default) or Istio.

### Failure mode

- Gateway down → clients cannot reach services (by design — no bypass). HA: 2+ gateway replicas, load-balanced.
- OPA down → gateway fails closed (deny) for write operations, fails open (allow cached decisions) for read operations with a short cache TTL (30s). Unverified — confirm OPA failure-mode configuration supports this read-open/write-closed split before relying on it.

### Local form

Gateway container + one BFF container + OPA container. Downstream services replaced by contract stubs (Prism or a generated mock server from OpenAPI). OIDC via a local Keycloak container with pre-seeded test realms.

---

## 5. Device/Event gateway (cloud side)

### Responsibility

Terminate device protocols. Authenticate devices. Bridge device messages to Redpanda.

- **EMQX** — MQTT broker. Device authentication via per-device mTLS or PSK (declared via `DeviceClass` CR → controller pushes auth/ACL to EMQX). Bridge to Redpanda via EMQX Kafka data integration (EMQX rule engine → Kafka produce). Meshtastic devices use native MQTT, terminating at EMQX.
- **ChirpStack** — LoRaWAN network server. Device activation (OTAA), uplink/downlink. Bridges to Redpanda via ChirpStack's integration (HTTP webhook → a small bridge service, or ChirpStack's Kafka integration if available — unverified, confirm ChirpStack Kafka integration exists before relying on it).

### Device identity

Per-device credentials, not shared. A device is enrolled via a `DeviceClass` CR (type-level) and a device registration record (instance-level — stored in Postgres, not in a CRD, to avoid per-device CR cardinality). The controller materializes auth/ACL entries into EMQX.

### Scope

This section defines the **cloud-side interface** only. Full device/edge architecture (offline capture, local journal, custody on device, scanner UX) is a future `device-edge.md` file.

### Dependencies

- Redpanda (bridge target).
- Postgres (device registry).
- cert-manager (device mTLS certs if PKI-based; or PSK material via a secrets controller).

### Failure mode

- EMQX down → MQTT devices cannot connect. EMQX persistence (queued messages) retains messages for connected-at-least-once clients; durable session resumes on reconnect. Devices that are offline during the outage continue local capture (offline handoff).
- Bridge to Redpanda down → EMQX queues messages locally (bounded queue); if queue fills, EMQX applies backpressure. Monitor queue depth; alert before overflow.

### Local form

Single EMQX container + single ChirpStack container. `stack.yaml` provisions both with dev auth (self-signed certs, single test device class).

---

## 6. LLM gateway

### Responsibility

Chokepoint for all AI agent model access. No agent calls a model provider directly.

- **Model routing**: map agent class → model (provider, model name, version).
- **Prompt/response logging**: every call logged to `agents.actions` (metadata) and a redacted prompt/response store (lakehouse tail, PII controls apply).
- **PII redaction on input**: scan prompts for PII patterns before sending to the model; redact or reject. The agent never receives raw PII in a prompt if the AgentClass does not permit it.
- **Token-spend quotas**: per agent class, per tenant. Enforced before the call; over-quota → reject with a quota error.
- **No secrets in prompts**: agents receive capability handles (pre-authorized, scoped references — "you may write to topic X", not "here is the Kafka credential"). The LLM gateway and the domain API enforce the handle; the agent never holds a raw secret.

### Interfaces

- gRPC/REST: `AgentLLMCall { agent_run_id, agent_class, prompt, capability_handles }` → `{ response, token_usage, action_proposals }`.
- The gateway calls the configured model provider and returns the response. Action proposals (if the agent proposes a write) are returned as structured intents, not executed by the gateway.

### Dependencies

- Model provider(s) — external. Configured per environment; locally, a stub.
- Redpanda (`agents.actions`, `agents.runs`).
- OPA (for capability handle validation — is this agent class permitted this handle?).

### Failure mode

- Model provider down → gateway returns a retryable error; agent run records the failure; `AgentRun` status → `Degraded`. No fallback to a different model without an explicit `AgentClass` policy allowing it.
- Gateway down → agents cannot access models. By design — no bypass. Agent runs queue (KEDA scales consumers; runs wait or time out per their deadline).

### Local form

Stub/mock LLM gateway container returning canned responses based on the agent class and prompt. No external model provider needed for local dev.

---

## 7. Identity & policy

### Responsibility

- OIDC IdP integration for both front doors (kube API via OIDC auth, domain API gateway via OIDC token validation).
- OAuth2 token exchange (RFC 8693) for agent on-behalf-of: a scheduler exchanges its token for a short-lived, down-scoped token with an `act` claim naming the agent run. TTL = task deadline. The exchanged token's scopes = `(scheduler's scopes) ∩ (agent class capability ceiling) ∩ (task scope)`.
- ABAC engine: OPA (default). Consumes custody/assignment data as policy inputs. Decisions enforced at the domain API gateway and at Kafka ACL materialization.

### Agent effective privilege

```
effective_privilege(agent_run) =
  scheduler_role_privileges(scheduler)
  ∩ agent_class_capability_ceiling(agent_class)
  ∩ task_scope(agent_run)
```

Enforced outside the agent — by the gateway (ABAC), by Kafka ACLs (topic access), and by the LLM gateway (capability handles). The agent's own judgment is not a security boundary (prompt injection risk).

### Sysadmin separation

Platform/sysadmin roles (kube RBAC) cannot unwrap PII envelope encryption keys. The KMS/Vault policy grants unwrap only to a data-plane service identity, not to any human or platform role. This is a structural separation: sysadmins can operate the cluster but cannot read domain PII.

### ABAC policy inputs

OPA receives:
- The caller's identity and scopes (from the OIDC token).
- The requested operation (resource, action).
- Relationship attributes: customer relationship, current shift, assigned trip, active assignment, current custody state (from the journal/projection).

Policies are declared via `PolicyBundle` CRs and distributed to OPA sidecars/gateway. Versioned rollout; no in-place policy edits in prod.

### Dependencies

- IdP: Keycloak locally and in production by default (must support OIDC + token exchange); swap if the organization standardizes on a different IdP — see `open-decisions.md` entry 8.
- OPA (or Cedar — open decision).
- Postgres/Redpanda projections (for custody/assignment state fed to OPA as data).

### Failure mode

- IdP down → no new token issuance; existing tokens valid until TTL. Gateway continues with cached validation keys (JWKS cached with TTL). Write operations requiring fresh token exchange (agent scheduling) fail until IdP recovers.
- OPA down → see §4 failure mode (fail closed for writes, open for reads with short cache).

### Local form

Keycloak container (OIDC) + OPA container. Pre-seeded test realms with fixture identities per persona (see `personas-and-access.md`).