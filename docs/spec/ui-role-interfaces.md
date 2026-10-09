# UI Refactor: Role-Based Interfaces, Detail Pages, and Statistics

Status: DECIDED (2026-10-09; all §9 open decisions closed). Awaiting plan
approval before implementation. Target phase after location-tracking merge
(`main` at 0c643d5). Data-model changes are in scope.

## 0. Vocabulary (decided)

- **route** = the recurring pattern: ordered legs between stops, repeated on
  a schedule (`frequency_days` from `first_operating_date`). Never dated.
- **trip** = ONE instance of a route: a dated execution with its own
  timetable, assigned vehicle, and status (scheduled/in_progress/completed/
  cancelled). This renames the existing `route_operation` concept everywhere:
  DB table, datagen output, API, UI. (Decision 2026-10-09.)
- **crew** = the Keycloak realm role gating flight-crew self-service.
  (Decision 2026-10-09: role name is `crew`, replacing the earlier
  `on_board_staff` idea.)

The `trip` rename frees "trip manager" as a term — which is why the
persona is now **route manager** (manages routes: assigns vehicles and crew)
while **trip** alone always means a dated instance.

## 1. Goals

1. Role-tailored interfaces for three personas: maintenance manager, route
   manager, flight crew.
2. Graphics and statistics (charts, timelines, capacity/fatigue metrics).
3. A detail page for every domain unit (vehicle, route, trip, staff, order,
   cargo, passenger, operator, customer, maintenance window).
4. Write paths for route managers (manage routes, assign vehicles and crew).
5. A caching layer for all aggregation/statistics endpoints.

Non-goals (this phase): ABAC engine (OPA), offline journal, telemetry plane.
Authorization stays POC-grade: Keycloak role required per route/endpoint
(client hides nav, API enforces `requireRole`), matching the existing
POST/PATCH pattern in `api/src/routes/domain.ts`.

## 2. Role → persona mapping

| Persona | Keycloak role | Staff role (datagen) | Landing view |
|---|---|---|---|
| Maintenance manager | `maintenance` | maintenance_tech | `/fleet` (Fleet & Maintenance) |
| Route manager | `route_manager` (renamed from `trip_manager`, §9.1) | route_manager | `/operations` (Operations Control) |
| Flight crew | `crew` (new realm role) | captain, first_officer, cabin_lead, cabin_crew | `/my-trips` (My Schedule) |
| All others | unchanged | — | existing dashboard |

UI labels: "Maintenance Manager", "Route Manager", "Flight Crew".

The `trip` rename made the realm role `trip_manager` read as "manager of
trips" (= dated instances); decided 2026-10-09 to rename the realm role to
`route_manager` (§9.1 has the touch-point list).

Users without one of the three roles keep the current generic nav. Role
gating is additive: an admin sees everything.

## 3. Data-model changes

### 3.0 Rename: route_operation → trip (migration 006)

The existing `route_operation` table becomes `trip` (columns unchanged
apart from the trip rename below); the deploy path drops and recreates the
schema on every rollout, so this is a definition rename, not a data
migration. Cascade:

- DB: table `trip` (was `route_operation`), columns `trip_id` (was
  `operation_id`), indexes/constraints renamed to match.
- Datagen: `route_operations.jsonl` → `trips.jsonl`;
  `generate_route_operations` → `generate_trips`; record field
  `operation_id` → `trip_id`.
- API/UI: `/api/route-operations` → `/api/trips`; `/api/route-operations/:id`
  → `/api/trips/:id`; Prisma model `RouteOperation` → `Trip`.
- References: `cargo.operation_id` → `cargo.trip_id`;
  `passenger.operation_id` → `passenger.trip_id`; order planned legs'
  `operation_id` provenance field → `trip_id`.

### 3.1 Identity link (new column)

```
staff.keycloak_username TEXT UNIQUE  -- maps Keycloak user to a staff record
```

Datagen assigns usernames to flight_crew and management staff
(`j.captain-0007` style; deterministic). The Keycloak realm import gains the
matching users so login-as-staff works in the demo. Part of migration 006.

### 3.2 Crew assignment (new table + datagen generator)

The core missing dataset: which crew staffed which trip.

```
CREATE TABLE crew_assignment (
    assignment_id   TEXT PRIMARY KEY,
    trip_id         TEXT NOT NULL REFERENCES trip (trip_id),
    staff_id        TEXT NOT NULL REFERENCES staff (staff_id),
    crew_role       TEXT NOT NULL CHECK (crew_role IN
                        ('captain','first_officer','cabin_lead','cabin_crew')),
    schema_version  INTEGER NOT NULL DEFAULT 1,
    generated_at    DATE NOT NULL,
    UNIQUE (trip_id, staff_id)
);
CREATE INDEX idx_crew_assignment_trip  ON crew_assignment (trip_id);
CREATE INDEX idx_crew_assignment_staff ON crew_assignment (staff_id);
```

Datagen (`generate_crew_assignments`, after `generate_trips`): for each
non-cancelled passenger-type trip with scheduled_departure > anchor −
window_days, staff 2 flight crew (1 captain or first_officer + 1 cabin)
drawn from the operator's flight crew, round-robin so load spreads; a
small pool of pilots gets deliberately heavy schedules to make fatigue
metrics interesting. Written as `crew_assignments.jsonl`. Cargo trips get
no crew assignment (freighter crews out of scope this phase).

`transit_event.actor_id` keeps its role (it records who performed an
event, including ground crew); crew_assignment is the staffing record. The
transit generator should draw `flight_actor` from the trip's crew instead
of the operator-wide pool once crew_assignment exists — one source of
truth.

### 3.3 Fatigue and capacity: derived, not stored

No new stored facts. Fatigue is computed from crew_assignment + trip
timetables:

- **Duty hours per week** (rolling 7 days before anchor): sum over assigned
  trips of (last leg arrival − first leg departure) + 1h pre/post.
- **Consecutive duty days**: longest run of consecutive days with ≥1
  assignment ending at anchor.
- **Rest since last duty**: anchor instant − last trip arrival.
- **Thresholds** (constants in API): warn at >40h/week or >5 consecutive
  days or <12h rest; critical at >55h/week or >6 days or <10h rest.

Computed in the API on request (SQL view `crew_fatigue_v`, one row per
staff with the four metrics + level). Small data volumes make on-demand
computation fine; storing would duplicate truth.

### 3.4 Service records

`vehicle_maintenance` is the service record set (a/b/c checks, unscheduled).
No new table. The vehicle detail page presents windows as a timeline; the
maintenance window detail page lists the trips that were cancelled or
covered because of it (derivable from route_assignment reason + trip
status + dates).

## 4. API additions

All read endpoints open to authenticated users unless noted.

**Identity**
- `GET /api/me` → staff record + roles + shortcuts (404 if no staff link;
  non-staff admins get their Keycloak identity only)

**Vehicle / fleet (maintenance manager)**
- `GET /api/vehicles/:id` (exists) — extend with maintenance-window summary
- `GET /api/vehicles/:id/trips?status=` — trip history, legs included
- `GET /api/vehicles/:id/maintenance` — service records
- `GET /api/vehicles/:id/stats` — trips per month, hours flown (sum leg
  durations), maintenance events per type, utilization (% days with a
  trip vs maintenance days)

**Routes / trips (route manager)**
- `GET /api/routes/:id` — route + assignments + next trip
- `GET /api/routes/:id/trips` — dated instances
- `GET /api/routes/:id/crew` — crew per upcoming trip
- `GET /api/crew-assignments?tripId=&staffId=`
- `GET /api/staff/fatigue?operatorId=&level=` — crew_fatigue_v rows
- `POST /api/routes` (route manager) — create recurring route (legs,
  frequency_days, first_operating_date; trips generated server-side)
- `PATCH /api/routes/:id` (route manager) — change frequency/base vehicle
  going forward (append a route_assignment; never rewrite history)
- `POST /api/crew-assignments` (route manager) — assign staff to a future
  trip (validates crew_role, staff operator matches, no fatigue violation
  at critical level)

**Crew (self)**
- `GET /api/my/assignments?from=&to=` — own crew_assignment + trip timetables
- `GET /api/my/fatigue` — own crew_fatigue_v row
- `GET /api/my/next` — next upcoming trip (schedule planning)

**Stats (dashboards)**
- `GET /api/stats/fleet` — per-operator: vehicles active/maintenance/stored,
  completed vs cancelled trips, maintenance backlog
- `GET /api/stats/operations?days=30` — trips per day by status, top routes
  by completed count, capacity utilization (seats flown vs available from
  crew assignments × seat config)
- `GET /api/stats/crew?operatorId=` — fatigue distribution, duty-hours
  histogram, per-role coverage

### 4.1 Stats cache

All aggregation/statistics endpoints (`/api/stats/*`, per-unit `/stats`
endpoints, and `crew_fatigue_v` reads) are served through a cache layer:

- **Mechanism**: single-process in-memory TTL cache in the API
  (`src/lib/statsCache.ts`), keyed by endpoint + normalized query
  (`fleet`, `operations:30`, `crew:opr-0001`, `fatigue:opr-0002:warn`).
  No Redis: one API replica, small data volumes; adding a cache server is
  infra this phase doesn't need.
- **TTLs**: stats endpoints 60s; fatigue reads 30s (fatigue feeds
  assignment decisions, so it stales faster); `/api/me` and detail reads
  uncached.
- **Invalidation**: explicit on write endpoints — POST/PATCH routes,
  POST crew-assignments, and any future write clears affected keys
  (route write → `operations:*` and `crew:*`; crew write → `crew:*` and
  `fatigue:*`). TTL is the backstop for out-of-band changes (datagen reload
  on pod restart rebuilds everything anyway).
- **Headers**: cached responses carry `Cache-Control: private, max-age=<ttl>`
  so the browser aligns with server TTL; the SPA's apiFetch does not add
  its own client cache (browser handles it).
- **Observability**: `X-Cache: hit|miss` response header; cache hits/misses
  logged at debug level. Unit tests assert invalidation on writes and TTL
  expiry behavior.

## 5. UI refactor

### 5.1 Structure

```
src/
  AppLayout.tsx        — role-aware nav (sections filtered by role)
  lib/auth.ts          — unchanged
  lib/api.ts           — typed fetch helpers (new; views stop hand-rolling)
  lib/format.ts        — date/duration formatting (new)
  components/          — shared: StatCard, DataTable, Badge, Timeline,
                         DetailHeader, EmptyState (new)
  charts/              — thin recharts wrappers: LineTrend, BarStack,
                         DonutBreakdown, GanttTimeline (new)
  views/
    dashboard/DashboardView.tsx      — generic overview (stats cards + charts)
    fleet/FleetView.tsx              — role landing: maintenance manager
    fleet/VehicleDetailPage.tsx
    fleet/MaintenanceDetailPage.tsx
    operations/OperationsView.tsx    — role landing: route manager
    operations/RouteDetailPage.tsx
    operations/TripDetailPage.tsx
    operations/RouteEditor.tsx       — create/edit + crew assignment
    crew/MyTripsView.tsx             — role landing: flight crew
    crew/StaffDetailPage.tsx          — per-staff: assignments, fatigue
    ...existing list views move under domain folders, unchanged behavior
```

### 5.2 Detail pages (one per unit, route per unit)

| Route | Data | Key sections |
|---|---|---|
| `/vehicles/:id` | vehicle + trips + maintenance + stats | spec card, trip-history timeline, maintenance timeline, utilization charts |
| `/vehicles/:id/maintenance/:mid` | window + impact | type/dates/facility, affected trips (cancelled/covered) |
| `/routes/:id` | route + assignments + trips + crew | itinerary stop chain, assignment timeline (per-vehicle intervals), upcoming trips table with crew, edit (route manager) |
| `/trips/:id` | trip + legs + crew + cargo/passengers booked | leg timetable, booked cargo and passengers lists, status |
| `/staff/:id` | staff + assignments + fatigue | personal trip history, upcoming schedule, fatigue metrics card |
| `/orders/:id`, `/cargo/:id`, `/passengers/:id`, `/operators/:id`, `/customers/:id` | existing rows + joins | record + related lists (cargo: booked trip + event chain) |

Every list view gains row links to its detail page.

### 5.3 Role views

**Fleet (maintenance manager)** — `/fleet`
- Fleet status donut (active/maintenance/stored) per operator
- Maintenance backlog: scheduled windows in next 30 days (Gantt timeline)
- Vehicle table → `/vehicles/:id`
- Vehicle detail: trips/month line, maintenance-per-type bars,
  cancelled-trips feed

**Operations (route manager)** — `/operations`
- Trips-per-day stacked bars (completed/in_progress/scheduled/cancelled)
- Route capacity utilization trend
- Crew fatigue board: table of crew with warn/critical badges, sorted by
  duty hours; clicking → `/staff/:id`
- Route table with assignment-count column → `/routes/:id`
- Route editor: legs editor, frequency picker, vehicle picker (filtered to
  operator's non-stored aircraft), crew assignment per upcoming trip with
  fatigue-warning inline feedback

**My Trips (flight crew)** — `/my-trips`
- "My fatigue" stat card (hours this week, consecutive days, rest since last)
- Past trips (history list/timeline) and next-14-days schedule
- Upcoming trip cards with legs, crewmates, rest period between duties

### 5.4 Charts

recharts (v2; React 18 compatible, boring choice). Wrappers in `src/charts/`
keep views free of recharts imports and make unit testing trivial. No
custom canvas; no map library this phase (stop chains render as text
arrows, as today).

## 6. Datagen changes

1. Rename `generate_route_operations` → `generate_trips`; output file
   `trips.jsonl`; record field `operation_id` → `trip_id` (per §3.0).
2. `generate_crew_assignments` (new, after trips; before transit events) —
   per §3.2, including a deliberately overloaded pilot subset.
3. Staff records gain `keycloak_username` (§3.1).
4. `generate_transit_events` draws flight actors from the trip's crew
   assignment (fallback to operator pool when absent).
5. Keycloak realm ConfigMap gains demo users for crew + route manager +
   maintenance personas, and the new `crew` realm role.
6. Load order: crew_assignment after trip, before cargo (crew referenced
   only by staff FK; order flexible but keep it deterministic).

## 7. Deployment changes

- Migration 006 (rename `route_operation` → `trip` per §3.0,
  `staff.keycloak_username`, `crew_assignment`, `crew_fatigue_v` view) →
  api.yaml initContainer + ConfigMap create command.
- `trips.jsonl` and `crew_assignments.jsonl` in datagen output + loader
  blocks (renamed `route_operations.jsonl` block becomes `trips`).
- Keycloak realm ConfigMap re-import: add `crew` role + demo users
  (rolling Keycloak restart).

## 8. Test plan

- Datagen invariants (throwaway checker): every crew_assignment's trip is
  non-cancelled passenger-type; staff is flight_crew of the same operator;
  no staff appears twice on one trip; every transit flight actor on a trip
  with crew is in that crew set.
- API unit tests: new endpoint mocks; fatigue view query shape; route-manager
  role enforcement on POST/PATCH; crew-assignment validation (fatigue
  critical rejection); stats-cache TTL and invalidation behavior.
- UI tests: route gating renders role sections; detail pages fetch and
  render for sample fixtures; chart wrappers smoke-test with mock data.
- Live suite: new `testCrew` (assignment/fatigue consistency via API),
  `testMe` (identity link), extend the operations suite with crew checks
  and trip-rename updates.

## 9. Open decisions

1. **Route manager realm role name** — DECIDED 2026-10-09: rename
   `trip_manager` → `route_manager`. Touch points: Keycloak realm import
   (role + `tripmgr` demo user's role mapping), `requireRole` calls in
   `api/src/routes/domain.ts`, personas spec persona/matrix labels
   (docs/spec/personas-and-access.md), datagen `staff.role` value
   `trip_manager` → `route_manager` (staff CHECK constraint update rides in
   migration 006), live-test persona assertions. The demo user keeps the
   `tripmgr` username (login name is opaque) but its role mapping moves to
   `route_manager`.
2. **Identity mapping** — DECIDED 2026-10-09: nullable UNIQUE
   `staff.keycloak_username` column (§3.1). One indexed lookup in
   `/api/me`; no separate identity table this phase.
3. **Route writes and history** — DECIDED 2026-10-09: PATCH closes the
   current assignment interval the day before the effective date, appends
   a new assignment interval, and regenerates only trips on/after the
   effective date (delete + reinsert). Past trips are immutable. The PATCH
   rejects if regeneration would drop crew assignments (re-assign first
   or include crew in the same request). Invariant: assignment intervals
   always match the vehicles of the trips they cover.
4. **Fatigue thresholds** — DECIDED 2026-10-09: warn >40h/week duty,
   >5 consecutive duty days, <12h rest; critical >55h/week, >6 days,
   <10h rest. Level = the highest triggered of the three metrics; any
   critical metric makes the row critical. Values live in one named
   FATIGUE_THRESHOLDS constant module (trivially tunable; can become
   per-operator config later without data migration). Deliberately above
   regulatory lines so demo data shows a mix of levels, not all-critical.

## Decision log

- 2026-10-09: Personas renamed — "Maintenance Manager" (was maintenance
  engineer), "Route Manager" (was trip manager; owns assigning vehicles
  and staff to routes).
- 2026-10-09: Stats cache layer required for all aggregation/statistics
  (design in §4.1).
- 2026-10-09: Route-instance concept named **trip**; `route_operation`
  renames everywhere (§3.0).
- 2026-10-09: Flight-crew realm role named **`crew`** (supersedes the
  earlier same-day choice of reusing `on_board_staff`).
- 2026-10-09: Realm role `trip_manager` renamed **`route_manager`**
  (touch points listed in §9.1).
- 2026-10-09: Identity mapping = nullable UNIQUE `staff.keycloak_username`
  column; no `staff_identity` table (§9.2).
- 2026-10-09: Route PATCH = close + append assignment interval, regenerate
  only trips on/after the effective date; past trips immutable; rejects if
  crew assignments would be dropped (§9.3).
- 2026-10-09: Fatigue thresholds = 40h/5d/12h warn, 55h/6d/10h critical,
  highest-metric-wins level, in a single FATIGUE_THRESHOLDS constants
  module (§9.4).