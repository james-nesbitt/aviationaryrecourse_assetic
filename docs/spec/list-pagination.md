# Plan: server-side pagination for large entity lists

Status: DECIDED (2026-10-10; decision 1b: cursor paging — ?after=<cursor>&limit=N, no total count, prev/next UI. Cursors are opaque page tokens encoding the last row's order keys, so compound natural-key orderings stay stable.) New cycle after entity-CRUD (PR #4).
Scope: every entity list currently fetches ALL rows and the UI slices to
a client-side `limit` (200) with no way past it — trips returns 5149
rows over the wire then hides 4949 of them.

## Context

`GET /api/trips` returns the full table (5149 rows on the deployed
dataset) with no pagination. `EntityListPage` fetches everything, then
`spec.limit` truncates the render to 200 rows and appends "(showing
200)" — the remaining rows are unreachable. Three registry entries carry
`limit: 200` (trips, crew-assignments, and one more), and every list has
the same wire-over-fetch problem even where the count is small today.

The registry already has per-entity `filters` (e.g. trips filter by
status, route, vehicle, operator server-side), so the filtering half
exists; what's missing is paging.

## Open decisions (blocking)

## Decision (2026-10-10)

**1b: cursor paging.** `?after=<cursor>&limit=<n>` where the cursor is an
opaque, base64-encoded token carrying the last row's sort keys (the
endpoint's orderBy tuple), so compound orderings (trip_id+crew_role,
vehicle_id+start_date) page stably regardless of natural-key shape.
Response envelope: `{ rows, next_cursor }` — next_cursor null at the
end. No total count and no page numbers: the UI renders prev/next with
the rows shown, page state (after-token stack) in URL search params so
links stay shareable and the back button works. Prev is a UI-maintained
token stack, not a server concept.

## Proposed design (pending decision)

### API
- All list endpoints that can be large accept paging parameters:
  trips, crew-assignments, cargo, passengers, transit events and, for
  uniformity, every registry list endpoint.
- Response shape becomes `{ rows: [...], total: <count>, page, page_size }`
  for offset paging (or `{ rows, next_cursor }` per decision).
  The `where`-building and soft-delete filtering stay as-is; the count
  query runs the same where.
- Breaking-change note: the UI is the only consumer of these list
  endpoints (live suite asserts status 200 + array for some — the suite
  must be updated to the envelope; this is the same contract-update
  pattern as the journal actor_id change, recorded in the PR).

### UI
- `EntityListPage` drops client-side slicing entirely; the registry
  `limit` field is removed. It reads page state from URL search params
  (shareable/back-button-friendly) and renders a pager under the table:
  "X–Y of Z" with prev/next and page numbers (or prev/next only per
  decision).
- The `detailPath`/expansion behavior is unchanged — pagination only
  affects which rows are fetched.

### Tests
- API: paging unit tests (page math, envelope shape, count respects
  the same filters and soft-delete).
- Live suite: updated to the envelope on affected endpoints plus a
  page-2 assertion on trips (page 1 first id ≠ page 2 first id).
- G4: browser walk — trips list pages through 103 pages, page state
  in the URL, filters combine with paging.

## Verification
- G2: scratch-DB unaffected (no schema change).
- G3: api + ui suites, tsc, build.
- G4: browser paging on trips (5149 rows), crew-assignments, cargo.
- G5: live suite after deploy (330 baseline must hold with the
  envelope updates).

## Out of scope
- Full-text search across entities (separate cycle if wanted).
- Sort-by-column (the registry has no sort metadata yet; paging first,
  sorting rides the same parameter plumbing later).
- The dashboard tables (bounded by their queries already).