# Engineering model

How the assetic system is built and operated. This file governs the development workflow; component behavior lives in `cloud-components.md`.

## Environment tiers

| Tier | Runtime | Purpose | Access |
|---|---|---|---|
| **Local** | containerd-compatible: compose, kind/k3d, or bare container | one component + its direct deps; unit + functional tests | engineer-owned, disposable |
| **Dev** (shared) | small k8s cluster | continuous deploy from trunk; frontend/device teams' default target | broad engineer access, synthetic data only |
| **Staging** | small k8s, prod-shaped topology | full integration, access/policy testing, load testing, upgrade rehearsal | CI-driven; humans read-mostly |
| **Prod** | full HA k8s/Redpanda, multi-AZ | real operations | low access: GitOps-only changes, break-glass audited |

### Promotion is artifact promotion, not rebuild

The same image digest + manifests flow dev → staging → prod via GitOps (kustomize or helm overlays vary only scale, replicas, endpoints, secrets). If it was not tested in staging byte-for-byte, it does not ship.

## Local partial stacks

Rule: **every core component must run in degraded-but-real form on a laptop.** This is a gate on technology admission. Applied to current choices:

| Component | Local form |
|---|---|
| Postgres | single container |
| Redpanda | single-node container (KRaft mode, schema registry) |
| EMQX + ChirpStack | single containers each |
| OPA | single container |
| API gateway + BFF | containers + contract stubs for downstream |
| LLM gateway | stub/mock container |
| Controllers/CRDs | kind/k3d when the component under test is control-plane; otherwise not required |
| Keycloak (OIDC) | single container |

### Mechanics

- Each repo ships a `stack.yaml` (docker compose) or kind profile declaring its minimal dependency slice.
- **Testcontainers** for functional tests so `make test` needs zero pre-arranged state.
- **Contract-first** (OpenAPI/AsyncAPI/registry schemas): neighbors are consumed as generated stubs or recorded contracts locally. You never need a teammate's service running to test yours.
- Contract tests (consumer-driven, e.g. Pact or schema-registry compatibility checks) run in CI to keep stubs honest.

## Test ownership ladder

| Level | Runs | Gates |
|---|---|---|
| Unit | local + CI, no infra | merge to trunk |
| Functional (component + Testcontainers deps) | local + CI | merge to trunk |
| Contract (consumer/provider, schema compat) | CI | merge to trunk |
| Integration (cross-service, real wiring) | staging, on promotion | promotion to staging "green" |
| **Access/policy tests** | staging | release candidate |
| Load/soak | staging, scheduled + pre-release | release candidate |

### Access/policy tests

A **synthetic persona suite** — one fixture identity per role (asset manager, loading operator, agent-run-on-behalf-of, etc.) — asserting both allowed *and denied* operations against the deployed ABAC/RBAC/topic-ACL surface. Policy regressions are release blockers, same severity as data loss. This is the only place the security model is continuously proven.

## Frontend/app/device development

- Apps target **dev by default**, staging for release validation, prod only as released builds.
- Per-environment OIDC realms and endpoint config baked into build flavors; no environment switching by editing code.
- **The server is the sole authority on business logic.** Apps render state, capture intent, and queue events. Any rule an app duplicates for UX (e.g. "can't unload before arrival" greying a button) is advisory client-side and re-validated server-side. The server's rejection path is a tested contract, not an error case.
- App test scope: unit + functional against generated contract mocks. No business-rule tests in apps.

## Prod posture

- **No interactive mutation.** Changes arrive as Git merges. `kubectl` write access is break-glass, journaled, alerting.
- **Upgrade rehearsal is mandatory** for k8s/Redpanda/Postgres version bumps. Staging exists partly to be broken by upgrades first.
- **Backup/restore and journal-replay drills** are scheduled exercises with pass/fail criteria, not documentation.
- **Redpanda/Kafka, Postgres, and IdP** are the base system; their HA posture applies in prod and is relaxed in dev/staging.