# Plan: security hardening — journal gate, mass-assignment, JWT audience

Status: DECIDED (2026-10-10; all three decisions resolved same day: 1a journal_writer realm role, 2b shared pickFields helper, 3a audience protocol mapper + verify audience assetic-api). Follows the three code-level findings from
the security review of the merged role-interfaces work (PR #2). One
security-hardening cycle, one PR.

## Context

The review found the token surface sound (real JWKS verification, CORS
pinned to the UI origin, no XSS sinks, journal INSERT-only in the DB)
but three genuine flaws in the write path:

1. `POST /api/journal` (api/src/routes/journal.ts:24) has no
   `requireRole` call: every authenticated persona — `viewer`, `crew` —
   can append to the append-only audit journal. The attribution field
   `actor_id` is taken from the request body, so any token holder can
   forge entries attributed to someone else. The journal is the
   designated source of truth, so its integrity currently depends on
   the honesty of the least-privileged user.
2. Four write endpoints (api/src/routes/domain.ts:644-675) pass the
   raw body into Prisma with `as never`: `POST/PATCH /api/operators`,
   `POST/PATCH /api/orders`. A PATCH can set any column including
   `schema_version`, `generated_at`, `keycloak_username` and arbitrary
   foreign keys.
3. `verifyToken` (api/src/lib/auth.ts:33) checks the issuer but not the
   audience: the API accepts any token the realm minted for any client.
   Two clients exist (`assetic-ui` public, `assetic-api` bearer-only),
   so a UI-session token and any future client's token are
   interchangeable at the API.

## Decisions to resolve (blocking, per the delivery skill)

1. **Journal append role gate** — options:
   a. New `journal_writer` realm role held by `admin` and the API's
      own service identity (matches high-assurance intent; no persona
      writes the journal directly today — datagen loads it and the API
      only appends internally).
   b. Gate on the existing `asset_manager` (simplest; one more power
      to an already-privileged role).
2. **Mass-assignment fix shape** — options:
   a. Per-endpoint explicit field pick: `const data = { name: body.name, ... }`.
      Boring, obvious, no new abstraction. ~10 lines per endpoint.
   b. Shared whitelist helper (`pickFields(body, ["name", ...])`).
      One small exported function; guards future endpoints uniformly.
3. **JWT audience** — `jwtVerify(..., { audience: "assetic-api" })`
   requires the realm to mint `assetic-api` into the audience claim.
   Options:
   a. Add an audience protocol mapper to the `assetic-ui` client (the
      UI's tokens then carry `aud: ["assetic-ui", "assetic-api"]`).
   b. Verify `audience: "account"` (Keycloak's default) — no realm
      change, but checks nothing client-specific.

## Proposed changes (pending the three decisions)

### 1. Journal append gate
- `requireRole(request.user!, <decided role>)` at the top of
  `POST /api/journal`.
- `actor_id` derived from `request.user!.sub` — the body value is
  ignored (rejected with 400 if present and non-null, so callers learn
  the contract changed rather than silently mis-attributing).
- Tests: persona with the role → 201; `viewer` → 403; body-supplied
  `actor_id` → 400 or overridden (per decision); appended row's
  `actor_id` equals the token sub.
- Live suite: `viewer` POST /api/journal → 403 assertion.

### 2. Field whitelists on writes
- domain.ts write endpoints take an explicit mutable-field set per
  endpoint. `schema_version`, `generated_at`, `keycloak_username`
  never client-settable.
- Tests: PATCH with a forbidden field does not change it; PATCH with
  only allowed fields succeeds (vitest, mocked Prisma asserting the
  `data` object).

### 3. JWT audience check
- `verifyToken` adds the decided audience.
- realm-import.json: audience protocol mapper if decision 3a.
- Live suite: token for the UI client still works (it must, post-fix).

### 4. Realm change note
Any realm-import.json change redeploys via the documented recreate
path (single-key ConfigMap, pod delete). The `assetic-api-secret-dev`
value in the realm file is a fixture of the same class as the demo
passwords — not in scope here, but recorded.

## Verification

- G2: scratch-DB rebuild unaffected (no schema change — no migration).
- G3: api vitest (new journal + whitelist tests), ui vitest (no UI
  change expected), tsc both packages.
- G4: browser login still works end to end (audience change is the
  risk point; verify all personas).
- G5: live suite; baseline 325 must hold.

## Out of scope

- sessionStorage token storage (accepted SPA tradeoff for a POC).
- Rate limiting, request-size caps, CSP headers (no reverse-proxy
  story yet; separate cycle if the app ever faces the internet).
- The `assetic-api-secret-dev` client secret in the realm fixture.

## Standing constraints

Branch `feature/security-hardening` off `main`. Commit attribution
line. No deploy without Gate 2 approval; the realm change makes the
deploy mandatory for the audience fix to take effect, so this plan's
publish step includes the documented realm redeploy path.