# Plan: entity CRUD with a permission model, and icon-based navigation links

Status: DECIDED (2026-10-10; decisions resolved same day: 1a domain-role permission model, 2a soft delete via deleted_at columns with filtered reads, 3b lucide-react icon library). New cycle after security-hardening (PR #3).
Scope: every registry entity gains Create/Read/Update/Delete with an
explicit per-entity permission model, and the UI replaces text links
("Open full detail →", "Open →") with icons.

## Context

Today only 4 of 14 entities are writable, with ad-hoc role gates:
operators (asset_manager), orders + routes + crew assignments
(route_manager). Everything else is read-only. Deletion exists in one
internal path (route update trips regeneration) but no DELETE endpoint.
The UI exposes detail links as text in three places: ExpandableTable's
row action and summary panel ("Open →", "Open full detail →",
components/index.tsx:286,296) and the admin panel dashboard links
("→ " suffixed, AdminPanelView.tsx:78-80).

The permission question is the load-bearing decision: the realm already
has a role vocabulary that matches operational domains rather than
per-table CRUD — asset_manager, account_manager, route_manager,
maintenance, loading_team, crew, analytics, journal_writer, sysadmin.

## Open decisions (blocking)

1. **Permission model shape** — options:
   a. Domain-role model: each realm role owns a domain of entities
      (asset_manager → fleet/vehicle/maintenance/reference; route_manager
      → routes/trips/crew assignments; account_manager → customers/
      orders/cargo/passengers; maintenance → vehicle maintenance;
      sysadmin → everything incl. delete). One table, one role per
      domain, admin override everywhere. Mirrors how the personas
      already work and how a real operator assigns responsibility.
   b. Per-entity RBAC matrix: an explicit operations × entities grid
      (create/read/update/delete × 14 entities) in a config file, roles
      mapped onto it. More precise, more moving parts, and most cells
      would be either "domain role" or "admin anyway".
2. **Delete semantics** — the journal is the source of truth and the DB
   has FKs. Options:
   a. Soft delete: a status/valid_to column (or journal entries) marking
      records inactive; reads filter them. Matches the high-assurance,
   b. Hard DELETE endpoints for the owning domain role + sysadmin, with
      FK-ordering left to Postgres (deletes fail if referenced — e.g.
      an operator with vehicles). Simple, and the failure mode
      (409-style error) is honest for a POC.
3. **Icon strategy** — options:
   a. Inline SVG icon set in a single ui/src/icons.tsx (no dependency;
      ~15 icons: open-detail, new, edit, delete, external, dashboard).
   b. An icon library (lucide-react etc.) — dependency weight vs. polish.

## Proposed design (pending decisions)

### API
- A single permissions module `api/src/lib/permissions.ts`: a
  declarative `PERMISSIONS` record per entity × operation → allowed
  role(s), read by every write endpoint. requireRole stays the
  enforcement primitive. This replaces the scattered inline
  requireRole calls in domain.ts.
- Generic write route registration for the 14 registry entities, driven
  by the same shape the UI registry uses: allowed fields (extending
  pickFields' allowlists), required fields, natural key.
- PATCH/POST on every entity; DELETE per decision 2.
- Journaling: every successful create/update/delete appends a
  journal entry (event types already include dispatch.created/
  dispatch.updated; delete may need one new event type in the CHECK
  constraint — migration 008 or reuse agent.action).

### UI
- Icons per decision 3: detail-open icon replaces the text links;
  a per-row edit affordance and a "New" button per list, shown only
  when the user's roles permit the operation (the API enforces; the
  UI hides what the token can't do).
- EntityListPage gains a toolbar: New button + per-row Edit/Delete
  icon actions gated on the same permission model, surfaced to the
  client via /api/me (roles already returned).
- Admin panel dashboard links gain directional icons.
- Detail pages gain an Edit affordance on the header.

### Tests
- permissions unit table test (every entity × operation has a role).
- Per-entity write tests: create/patch happy path asserts the Prisma
  call payload; forbidden role → 403; provenance fields dropped.
- Live suite: one create→read→update→(delete) round-trip per domain
  role persona, plus 403s for a wrong persona.

## Verification
- G1: no datagen change.
- G2: scratch-DB rebuild; CRUD round-trip smoke per entity incl. FK
  failure behavior for deletes.
- G3: api + ui suites; tsc; build.
- G4: browser walk per persona: New/Edit/Delete buttons appear only
  for permitted roles; icons render everywhere text links were.
- G5: live suite after deploy (baseline 326).

## Out of scope
- Bulk operations, import/export.
- Optimistic concurrency (If-Match/versioning) — noted as the known
  gap from the improvement review; separate cycle.
- Realms beyond the existing role vocabulary (no new personas).