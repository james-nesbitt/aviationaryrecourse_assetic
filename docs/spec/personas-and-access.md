# Personas and access

## Personas

| Persona | Primary aggregates | Access pattern | Authz granularity |
|---|---|---|---|
| **Asset manager** | asset masters, device classes, fleet config | read + write (GitOps-reviewed for master changes) | RBAC (role-based) at the operator/asset-manager tier |
| **Account manager** | customers, contracts, billing | read + write scoped to assigned customers | ABAC (customer relationship) |
| **Trip manager** | trips, dispatches, manifests | read + write scoped to assigned trips/region | ABAC (assigned trip + region) |
| **Maintenance** | vehicles, maintenance records, work orders | read + write scoped to assigned vehicles/work orders | ABAC (assignment) |
| **Loading team** | cargo, custody, manifests | read + write scoped to current shift + assigned trip | ABAC (shift + assignment + custody state) |
| **On-board staff** | passengers, custody, manifests, telemetry | read + write scoped to current trip; offline-tolerant | ABAC (current trip + custody state); offline local journal |
| **Analytics / telemetry / security** | projections, telemetry, audit logs | read-only; separate lakehouse plane | ABAC (tenant + dataset); no PII unwrap |
| **System administrators** | cluster, infra, operators | read + write (GitOps); no domain data | RBAC (kube); structurally walled from domain PII |

## Authorization model

**ABAC** for domain access (account managers, trip managers, maintenance, loading, on-board). Decisions use relationship attributes:

- Customer relationship (is this account manager assigned to this customer?).
- Current shift + assigned trip (is this loading operator on shift and assigned to this trip?).
- Active assignment (is this maintenance tech assigned to this work order?).
- Custody state (does this actor currently hold custody of this item?).

**RBAC** serves the operator/asset-manager and platform/infra tier only (kube RBAC for sysadmins; coarse role-based for asset masters).

### Custody chain as authorization source

Custody events (`custody.accepted`, `custody.transferred`) in the hash-chained journal double as the authorization source for manifest writes. An actor may write to a manifest only if they currently hold custody of the relevant item. Access control and accountability are the same dataset — this is intentional.

## Access matrix (persona × aggregate × operation)

| Aggregate | Asset mgr | Account mgr | Trip mgr | Maintenance | Loading | On-board | Analytics | Sysadmin |
|---|---|---|---|---|---|---|---|---|
| **Asset master** | write (GitOps) | denied | read | read | denied | denied | read (no PII) | denied |
| **Customer/contract** | read | write (assigned) | read | denied | denied | denied | read (no PII) | denied |
| **Trip/dispatch** | read | read | write (assigned) | read | read | read (current) | read | denied |
| **Manifest** | read | read | write (assigned) | read | write (custody) | write (custody) | read (no PII) | denied |
| **Custody event** | read | denied | read | read | write (accept/transfer) | write (accept/transfer) | read (no PII) | denied |
| **Maintenance record** | read | denied | read | write (assigned) | denied | read | read | denied |
| **Telemetry** | read | denied | read | read | denied | read (current vehicle) | read | denied |
| **Audit/journal** | read | denied | denied | denied | denied | denied | read (no PII) | denied (no PII unwrap) |
| **Cluster/infra** | denied | denied | denied | denied | denied | denied | denied | write (GitOps) |
| **PII envelope keys** | denied | denied | denied | denied | denied | denied | denied | denied |

**Legend**: `write (X)` = write subject to condition X; `read (no PII)` = read with PII fields redacted/envelope-encrypted; `denied` = not permitted.

## Agent action tiers

AI agents acting on behalf of a persona operate under the same ABAC model, with an additional constraint: **high-risk actions may only be proposed, not executed.** The agent writes an approval-pending journal entry; a human with the right role approves.

| Action | Tier | For agent |
|---|---|---|
| Read asset master | low | execute |
| Write asset master | **high** | **propose only** |
| Read customer/contract | low | execute (no PII unless AgentClass permits) |
| Write customer/contract | **high** | **propose only** |
| Read trip/dispatch | low | execute |
| Write trip/dispatch | **high** | **propose only** |
| Read manifest | low | execute |
| Write manifest (custody held) | medium | execute if custody check passes; propose if uncertain |
| Write custody event | **high** | **propose only** (custody is a legal act) |
| Write maintenance record | medium | execute if assigned |
| Read telemetry | low | execute |
| Write audit/journal | — | never (agents read audit, never write it directly; their actions are journaled by the system) |
| Cluster/infra ops | **high** | **propose only** |
| PII envelope keys | denied | denied |

### Tier definitions

- **Low**: agent executes directly. Action is journaled with dual identity (initiator + agent).
- **Medium**: agent executes if the ABAC check passes unambiguously at execution time; otherwise proposes.
- **High**: agent may only propose. The proposal is an approval-pending journal entry. A human with the matching role approves or rejects. The approval decision is itself journaled (hash-chained). Agents draft, humans sign.

### Which actions are which tier is a concrete list, not a placeholder

The table above is the concrete list. It is derived from the principle: any action that changes a master, a dispatch, a custody chain, or infrastructure is high-risk because it affects legal accountability or safety configuration. Read operations and non-custody writes (maintenance records under assignment) are lower risk.