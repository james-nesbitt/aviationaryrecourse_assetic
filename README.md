# assetic POC

POC implementation: Postgres + Node/TypeScript API + React UI + Keycloak, orchestrated in Kubernetes.

## Structure

```
api/          — Node/TypeScript Fastify REST API with Prisma + Keycloak OIDC
ui/           — React + Vite + TypeScript SPA with Keycloak auth
db/migrations/— PostgreSQL schema (full spec domain model + hash-chained journal)
infra/
  compose/    — docker-compose for local dev
  k8s/base/   — kustomize manifests for k8s deployment
  keycloak/   — Keycloak realm import (roles, users, clients)
tools/datagen/— Python synthetic data generator (JSONL output)
```

## Local development

### 1. Generate synthetic data

```bash
cd tools/datagen
pip install -e .
assetic-datagen generate --scale small --out /tmp/datagen-out
```

### 2. Run the stack via docker-compose

```bash
docker compose -f infra/compose/docker-compose.yml up --build
```

This brings up Postgres, Keycloak, API, and UI.

### 3. Load data into the database

```bash
cd api
npm install
npx prisma generate
npx prisma db push   # sync Prisma schema to the DB (migrations run on Postgres init)
npm run load:data -- --dir /tmp/datagen-out
```

### 4. Access the UI

- UI: http://localhost:5173
- API: http://localhost:3001
- Keycloak: http://localhost:8080 (admin/admin)

### POC users (Keycloak realm: assetic)

| User                  | Password              | Roles                                                          | Lands on |
|-----------------------|-----------------------|----------------------------------------------------------------|----------|
| admin                 | admin                 | asset_manager, account_manager, route_manager, sysadmin, maintenance, crew | everything |
| tripmgr               | tripmgr               | route_manager                                                  | Operations Control |
| m.route_manager-0002  | m.route_manager-0002  | route_manager (linked to a staff record)                       | Operations Control |
| maintmgr              | maintmgr              | maintenance                                                    | Fleet & Maintenance |
| n.cabin_crew-0007     | n.cabin_crew-0007     | crew (linked to a staff record)                                | My Schedule |
| loader                | loader                | loading_team                                                   | shared lists |
| viewer                | viewer                | analytics                                                      | shared lists |

Role sections are additive: `asset_manager` and `sysadmin` see every
dashboard without the persona roles being mapped individually. Usernames of
the form `<initial>.<role>-<id>` match `staff.keycloak_username` in the
generated dataset, so `/api/me` resolves them to a staff record and the crew
self-service views have data.

## Kubernetes deployment

```bash
kubectl apply -k infra/k8s/base/
```

Requires:
- Namespace `assetic-poc` (created by the manifest)
- A StorageClass for the Postgres PVC
- An IngressClass (or use the NodePort fallback on port 30080)
- The API and UI images (`assetic/api:latest`, `assetic/ui:latest`) available to the cluster

### ConfigMaps carrying source, data and schema

The POC builds from source inside initContainers, so four ConfigMaps must be
refreshed whenever the corresponding inputs change:

```bash
kubectl -n assetic-poc create configmap assetic-db-migrations \
  --from-file=001_initial_schema.sql=db/migrations/001_initial_schema.sql \
  --from-file=002_app_role.sql=db/migrations/002_app_role.sql \
  --from-file=003_journal_hash_function.sql=db/migrations/003_journal_hash_function.sql \
  --from-file=004_location_tracking.sql=db/migrations/004_location_tracking.sql \
  --from-file=005_route_recurrence.sql=db/migrations/005_route_recurrence.sql \
  --from-file=006_trips_crew.sql=db/migrations/006_trips_crew.sql \
  --from-file=007_staff_date_of_birth.sql=db/migrations/007_staff_date_of_birth.sql \
  --from-file=008_entity_crud.sql=db/migrations/008_entity_crud.sql \
  --dry-run=client -o yaml | kubectl apply -f -
```

`assetic-api-source` and `assetic-ui-source` take a `source.tar.gz` of the
respective package; `assetic-datagen-data` takes a `data.tar.gz` of the
datagen output directory.

The `keycloak-realm` ConfigMap must contain exactly one key. Keycloak imports
every file in its import directory and skips any realm that already exists, so
a stale second key (for example both `realm.json` and `realm-import.json`)
silently shadows the intended file and the import is reported as
`Realm 'assetic' already exists. Import skipped`. Recreate rather than patch:

```bash
kubectl -n assetic-poc delete configmap keycloak-realm
kubectl -n assetic-poc create configmap keycloak-realm \
  --from-file=realm.json=infra/keycloak/realm-import.json
kubectl -n assetic-poc delete pod -l app.kubernetes.io/name=keycloak
```

### Secrets

No credential value lives in git. `infra/k8s/base/secrets.yaml` is a
template documenting the Secret shapes; the real `assetic-db-credentials`
is created out-of-band and its password never enters the repository:

```bash
kubectl -n assetic-poc create secret generic assetic-db-credentials \
  --from-literal=DATABASE_URL="postgresql://**REDACTED**@assetic-postgres:5432/assetic?schema=public" \
  --from-literal=POSTGRES_USER=assetic \
  --from-literal=POSTGRES_PASSWORD=<password> \
  --from-literal=POSTGRES_DB=assetic
```

`assetic-api-config` carries only non-secret configuration and is safe
to apply from the template.

The Keycloak realm import (`infra/keycloak/realm-import.json`) contains
demo accounts whose passwords equal their usernames — these are
throwaway fixtures for the POC dataset on an offline homelab realm,
marked `temporary: true` with the `demo-account` attribute. The live
test suite and the documented persona logins depend on these values;
they are not real credentials and must never be reused as such.

## Database schema

Matches the `tools/datagen` JSONL output exactly:
- Entity tables: operator, vehicle, ownership_history, staff, facility,
  carrier_customer, route, route_assignment, vehicle_maintenance, trip,
  crew_assignment, cargo, assetic_order, passenger, transit_event
- Reference tables: airport, aircraft_model
- Views: cargo_state, passenger_state, crew_fatigue_v, dataset_anchor_v
- 1 append-only hash-chained bitemporal journal: journal_entry
- Application role `assetic_app` with INSERT-only access to the journal (enforced at DB GRANT level)

The journal is the source of truth (spec invariant); state tables are derivable; journal wins on disagreement.