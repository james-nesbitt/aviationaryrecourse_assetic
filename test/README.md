# assetic testing

Two testing stacks: unit tests (local, no cluster) and live system tests (against a deployed environment).

## Unit tests

Run locally with no infrastructure. Uses vitest.

### API unit tests (`api/`)

```bash
cd api
npm install
npm test
```

Covers:
- `src/lib/auth.test.ts` — token verification, role checks (hasRole, requireRole), JWT creation/expiry
- `src/routes/journal.test.ts` — hash chain computation: determinism, tamper detection, chain integrity
- `src/routes/domain.test.ts` — route registration, CRUD handler behavior, auth enforcement (role-gated write endpoints)

### UI unit tests (`ui/`)

```bash
cd ui
npm install
npm test
```

Covers:
- `src/lib/auth.test.tsx` — token storage, expiry detection, getUser JWT parsing
- `src/views/components.test.tsx` — LoginView rendering and click handler, RoutesView loading/rendering, expand-only-one-row behavior, collapse on re-click

## Live system tests (`test/live/`)

Runs against a deployed environment via its URL. Tests the full stack: health, auth, data, journal, and per-persona access control.

```bash
node test/live/run-tests.mjs [BASE_URL] [KEYCLOAK_URL] [REALM]
```

Defaults: `https://assetic.home.arpa`, `https://assetic.home.arpa/auth`, `assetic`

Environment variables:
- `TEST_ADMIN_PASSWORD` (default: admin)
- `TEST_TRIPMGR_PASSWORD` (default: tripmgr)
- `TEST_LOADER_PASSWORD` (default: loader)
- `TEST_VIEWER_PASSWORD` (default: viewer)

### What it tests

1. **Health** — `/api/health` returns 200 with `status: ok`
2. **Auth config** — `/api/auth/config` returns correct Keycloak URL, realm, client ID
3. **Unauthenticated access** — API rejects requests without bearer token (401)
4. **Data endpoints** — All 10 read endpoints return 200 with arrays of expected minimum counts
5. **Journal write + verify** — POST two chained entries, verify chain integrity (all_valid=true, 2 entries)
6. **Auth/policy personas** — 4 synthetic users (admin, tripmgr, loader, viewer):
   - All can acquire tokens
   - All can read operators
   - Only asset_manager can POST operators (others get 403)

### Example

```bash
# Against the POC cluster
node test/live/run-tests.mjs

# Against a different environment
node test/live/run-tests.mjs https://staging.assetic.home.arpa
```