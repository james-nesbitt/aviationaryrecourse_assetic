# Open decisions register

Each entry: the decision, current default, who decides, what it blocks. Defaults are stated inline in the relevant component file; this file is the register. Changing a default requires updating both this file and the inline default in the same change.

| # | Decision | Options | Current default | Who decides | What it blocks |
|---|---|---|---|---|---|
| 1 | Mobile offline sync protocol | (a) roll-your-own delta sync; (b) embedded-replica SQLite + sync layer | **(b) embedded-replica** | platform eng + mobile lead | mobile architecture work |
| 2 | Gateway topology | (a) shared gateway with per-class routes; (b) gateway-per-front-door | **(a) shared** | platform eng | customer self-service door introduction |
| 3 | Approval tiers per persona | which agent/persona actions are direct vs propose-and-approve | **concrete list in `personas-and-access.md`** | security + domain leads | agent scheduling work |
| 4 | Stream processor | (a) Flink; (b) Kafka Streams; (c) none initially | **(c) none initially** — add when a concrete derived-event requirement appears | platform eng | geofence/ETA/anomaly work |
| 5 | ABAC engine | (a) OPA; (b) Cedar | **(a) OPA** | platform eng + security | policy enforcement implementation |
| 6 | Bitemporal store | (a) XTDB; (b) Postgres temporal via valid-time/transaction-time columns | **(b) Postgres with temporal columns** | platform eng | audit/regulatory queries |
| 7 | Customer self-service front door | when introduced | **reserved, not built** | product + security | customer-facing work |
| 8 | Production IdP | (a) Keycloak; (b) org-standard IdP (e.g. Okta, Auth0) | **(a) Keycloak** | platform eng + security | first prod deploy |
| 9 | GitOps tool | (a) Argo CD; (b) Flux | **(a) Argo CD** | platform eng | first prod deploy |

## Notes

- **Entry 1** (sync protocol): embedded-replica SQLite (e.g. PowerSync, or a custom layer over logical replication) is the default because it gives offline-first apps a real local database with conflict resolution, avoiding a hand-rolled delta protocol. Revisit if the mobile platform cannot support a local SQLite replica with acceptable size/perf.
- **Entry 2** (gateway topology): shared gateway is the default for simplicity and fewer moving parts. If the customer door introduces a materially different trust/traffic profile, split at that point.
- **Entry 3** (approval tiers): the list in `personas-and-access.md` is the default. It is derived from the principle that master/dispatch/custody/infra changes are high-risk. Security and domain leads confirm the list before agent scheduling is built.
- **Entry 4** (stream processor): no stream processor initially. Geofence, ETA, and anomaly detection are derived-event use cases; add Flink or Kafka Streams when one of these becomes a concrete requirement, not before.
- **Entry 5** (ABAC engine): OPA is the default; it is mature, embeddable, and integrates with the gateway as a sidecar. Cedar is a viable alternative if a simpler policy language or AWS-native integration is preferred. The choice does not change the policy model (ABAC consuming custody/assignment), only the engine.
- **Entry 6** (bitemporal store): Postgres with `valid_time`/`transaction_time` columns is the default. XTDB is a native bitemporal store that would simplify audit/regulatory queries but adds a second database engine. Revisit if bitemporal query patterns are painful in Postgres.
- **Entry 7** (customer door): reserved. Its threat model is out of scope for this pass. If scope expands, add `docs/spec/customer-gateway.md` and a new open-decisions entry for its topology.
- **Entry 8** (production IdP): Keycloak is the default for consistency between local and prod. If the organization standardizes on a managed IdP (Okta, Auth0, etc.), swap and ensure it supports OIDC + RFC 8693 token exchange (required for agent on-behalf-of). Not all managed IdPs support token exchange — verify before committing.
- **Entry 9** (GitOps tool): Argo CD is the default for its CRD-native model and pull-based reconciliation. Flux is a viable alternative with a different UX. Decide before the first prod deploy; the choice affects the GitOps repo layout.