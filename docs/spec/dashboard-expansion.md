# Plan: Dashboard Expansion — Locations, Accounts, Cross-entity Links

Status: DECIDED (2026-10-09; section 7 resolved same day: accounts include volume trends, maintenance impact ships as both an Operations section and route-detail tabs, airports get both presence and through-today views). Continues the role-interfaces phase
(`feature/role-interfaces`). Builds on the entity view contract in
docs/spec/ui-role-interfaces.md section 5.0: every entity has a row view, a
summary view and a tabbed detail page; dashboards compose those entities.

## 1. Goals

Dashboards stop being read-only summaries and become working surfaces where
each persona sees its own domain and can follow links into every entity it
mentions.

1. Fleet & Maintenance gains a **Locations** section: what is at each
   airport right now (cargo, passengers, vehicles).
2. Operations Control gains a **Maintenance impact** section.
3. Rows across both dashboards link every entity they name (operators,
   bases, vehicles, routes, staff, trips).
4. A new **Accounts** dashboard for the account-manager persona.
5. Airports are promoted from reference rows to entities with a real
   detail page.

## 2. Data-model changes

None. Everything needed exists:

- `cargo_state.current_location_iata` / `passenger_state.current_location_iata`
  (migration 004): location of each subject's last transit event.
- `vehicle.base_iata`: home of each vehicle.
- `customer.account_manager_id` (migration 001): the account-manager
  relationship the Accounts dashboard is keyed on.
- `vehicle_maintenance`, `route_assignment`, `trip`: maintenance impact is
  derivable.

## 3. API additions

- `GET /api/stats/locations` — per airport: cargo count, passenger count,
  based-vehicle count, ordered by total activity. Served through the stats
  cache (TTL 60s, invalidated on writes). SQL unions the three state
  projections; airports with zero activity are omitted.
  *(Drafted and typechecking; uncommitted — folded into phase 1.)*
- `GET /api/staff/:id/customers` — customers assigned to one account
  manager (or fold into the existing `/api/staff/:id` response; decide in
  implementation, keep it one query either way).
- No other endpoints: the Accounts dashboard composes existing
  `/api/customers`, `/api/customers/:id`, `/api/orders`, `/api/cargo` and
  `/api/stats/*`.

## 4. UI changes

### 4.1 Fleet & Maintenance (maintenance manager)

- **Locations section** (new): table of airports ordered by current
  activity — cargo on the ground, passengers in transit via, vehicles based —
  each row linking to the airport detail page.
- **Row links**: every dashboard row that names an entity links to its
  detail page. Aircraft table gains operator and base columns (both
  linked); maintenance backlog gains vehicle links (registration already
  shown unlinked).

### 4.2 Operations Control (route manager)

- **Maintenance impact section** (new): upcoming windows in the next 30
  days with the routes and trips they touch — trips already cancelled for
  maintenance, plus trips inside a window whose vehicle has no cover
  assignment. Each row links to the vehicle, the maintenance window and
  the affected route.
- **Row links**: crew fatigue rows link the operator; route rows link the
  vehicle; busiest-route rows already link routes.

### 4.3 Accounts (account manager) — new dashboard

Persona: the `account_manager` realm role. Landing page on login (joins the
existing redirect ladder: admin → panel, maintenance → fleet, route manager
→ operations, crew → own schedule, account manager → accounts).

- Stat cards: assigned customers, open orders, shipments in flight,
  total monthly volume under management.
- **Customers table**: each assigned customer with contract state, order
  and shipment counts, linking to the customer detail page.
- **Shipments needing attention**: cargo of assigned customers not yet
  delivered, ordered by state urgency.
- The dashboard is keyed on the logged-in account manager when their
  login is linked to a staff record (same identity link as crew);
  administrators without a link see all customers.

### 4.4 Airport detail page (new)

Airports are promoted from `ReferenceDetailPage` to a bespoke tabbed
dashboard, since they now answer real operational questions:

- **Overview**: identity facts (current reference view).
- **There now**: cargo and passengers currently at this airport (from the
  state projections), vehicles based here.
- **Served by**: routes whose pattern touches this airport; upcoming
  trips through it.

Registry: airport `detailPath` already routes here; only the page component
changes.

### 4.5 Navigation

- Nav gains `Accounts` gated on the `account_manager` role (admins see it
  via ADMIN_ROLES, as with the other dashboards).
- `landingPath` adds the account-manager branch.
- Admin panel gains a "Role dashboards" link entry for Accounts.

## 5. Out of scope (this expansion)

- Charts on the Accounts dashboard (counts and tables first; trend lines
  when there is a metric worth trending).
- Live "where is it right now" tracking beyond the anchor-instant view the
  data supports.
- Warehouse/facility views (facilities exist but have no state projection;
  a future expansion).

## 6. Verification

Per the established gate sequence:

- G2: scratch-DB rebuild; new `/api/stats/locations` cross-checked against
  direct SQL for a sample of airports; maintenance-impact query checked
  against datagen's cancelled/covered invariants.
- G3: unit tests for the new endpoint in the expected-routes list; nav
  gating and landing-path tests extended for the account-manager branch.
- G4: browser walk of both dashboards and the Accounts panel as each
  persona; every named entity in a row resolves to its detail page.
- G5: deploy + live suite (249 baseline, must stay green) + spot-checks of
  the new sections on the cluster.

## 7. Decisions (2026-10-09)

1. **Accounts dashboard scope**: customers/contracts AND volume trends —
   the dashboard ships per-account-manager order and shipment trend charts
   alongside the customer tables.
2. **Maintenance impact placement**: both — a section on Operations Control
   and a Maintenance tab on every route detail page covering that route.
3. **Airport "There now"**: both — the anchor-instant presence view (cargo,
   passengers, vehicles at the airport) and a "through this airport today"
   transit list derived from the legs of trips on the current operating day.