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

| User     | Password  | Roles                                        |
|----------|-----------|----------------------------------------------|
| admin    | admin     | asset_manager, account_manager, trip_manager, sysadmin |
| tripmgr  | tripmgr   | trip_manager                                 |
| loader   | loader    | loading_team                                 |
| viewer   | viewer    | analytics                                    |

## Kubernetes deployment

```bash
kubectl apply -k infra/k8s/base/
```

Requires:
- Namespace `assetic-poc` (created by the manifest)
- A StorageClass for the Postgres PVC
- An IngressClass (or use the NodePort fallback on port 30080)
- The API and UI images (`assetic/api:latest`, `assetic/ui:latest`) available to the cluster

## Database schema

Matches the `tools/datagen` JSONL output exactly:
- 9 entity tables: operator, vehicle, ownership_history, staff, facility, carrier_customer, cargo, route, assetic_order
- 2 reference tables: airport, aircraft_model
- 1 append-only hash-chained bitemporal journal: journal_entry
- Application role `assetic_app` with INSERT-only access to the journal (enforced at DB GRANT level)

The journal is the source of truth (spec invariant); state tables are derivable; journal wins on disagreement.