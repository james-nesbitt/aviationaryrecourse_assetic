# assetic-datagen

Synthetic testing data generator for the assetic platform. Produces JSONL
files (one per entity) that can seed Postgres loaders, Redpanda producers, or
any test harness.

Per the assetic engineering model, the Dev tier runs on **synthetic data
only** — this tool is the sanctioned source of that data.

## Entities

| File | Entities |
| `operators.jsonl` | passenger/cargo/military airline operators |
| `orders.jsonl` | customer orders: charter passenger groups and cargo bookings with multi-transit itineraries |
| `routes.jsonl` | planned carrier travel routes (ordered legs, scheduled times) |
| `vehicles.jsonl` | aircraft, ground support equipment, rail vehicles |
| `ownership_history.jsonl` | sales/leases moving vehicles between operators |
| `staff.jsonl` | flight crew, ground crew, and management (account managers, trip managers) |
| `facilities.jsonl` | hangars and warehouses |
| `carrier_customers.jsonl` | customers: cargo shippers and charter passenger-group clients, each with a responsible account manager |
| `cargo.jsonl` | shipments with origin/destination and assigned vehicle |
| `passengers.jsonl` | passengers carried on charter and scheduled passenger flights |
| `transit_events.jsonl` | unified per-subject state-transition event chains (transit_event log) |
| `airports.jsonl` | the resolved airport reference set actually used |
| `aircraft_models.jsonl` | the aircraft models actually referenced |

All records carry `schema_version: 1`. Every cross-file reference resolves
within the output set.

### Route semantics

Each route is one aircraft's planned operating-day itinerary for a passenger
or cargo operator: an ordered list of 2–5 legs that starts and ends at the
vehicle's base airport, scheduled 1–14 days after the anchor date. Leg
airports are gated by the model's great-circle range (×0.9), departure times
chain (each leg departs after the previous arrives plus a 45–120 min
turnaround), and cargo-operator legs may reference an open shipment
(`cargo_ref`) from `cargo.jsonl`. Military operators get no published
routes.

### Order semantics

Each order is a customer request to move a passenger group (charter),
freight, or both from an origin to a destination, possibly crossing
multiple transits/flights. The itinerary (`planned_legs`) chains legs from
routes published by the fulfilling operator when a temporally consistent,
non-cyclic path exists (`transit_route_ids` records the contributing
routes); otherwise a direct leg is planned on a plausible aircraft. Orders
carry the responsible `account_manager_id` (the customer's assigned account
manager) and `trip_manager_id` (the operator staff member who schedules
passenger/cargo assignment to flights), matching the assetic ABAC model.
Charter orders have a `passenger_group` (group name + pax count) and may
carry `accompanying_cargo_kg`; cargo orders have a `freight` block.

Staff generation includes management roles (~15% of staff): `account_manager`
(responsible for customer relationships) and `trip_manager` (schedules
assignment of passengers/cargo to flights). Customers are ~25% charter
clients, each with an assigned account manager at the contracted operator.

### Passenger semantics

Each passenger record is a person carried by an operator between a distinct
origin/destination airport pair. Charter-passenger orders materialize 2–3
passengers per order (linked via `order_id`); regular passenger operators
additionally get 5–15 standalone passengers with `order_id: null`,
representing scheduled-service bookings. `passenger_type` is weighted
adult/child/infant (80/15/5) and `status` is weighted
booked/checked_in/boarded/in_transit/arrived/disembarked (10/15/20/20/25/10).

### Transit event semantics

`transit_events.jsonl` is the unified state-transition log for both cargo
shipments and passengers. Each event records an `event_type` verb and the
transition it performs (`from_state` → `to_state`); every transition must
exist in the DB's `transit_transition` lookup table. The chain depth is
driven by the entity's `status` in `cargo.jsonl`/`passengers.jsonl`, which is
the expected terminal state (**test oracle**, not a stored column):

#### cargo states

scheduled, picked_up, loaded, in_transit, arrived, held, delivered

| event_type | from_state | to_state |
|---|---|---|
| `pickup` | `scheduled` | `picked_up` |
| `load` | `picked_up` | `loaded` |
| `load` | `arrived` | `loaded` |
| `load` | `held` | `loaded` |
| `depart` | `loaded` | `in_transit` |
| `arrive` | `in_transit` | `arrived` |
| `hold` | `arrived` | `held` |
| `deliver` | `arrived` | `delivered` |

#### passenger states

booked, checked_in, boarded, in_transit, arrived, disembarked

| event_type | from_state | to_state |
|---|---|---|
| `check_in` | `booked` | `checked_in` |
| `board` | `checked_in` | `boarded` |
| `depart` | `boarded` | `in_transit` |
| `arrive` | `in_transit` | `arrived` |
| `disembark` | `arrived` | `disembarked` |

Cargo chains start at `pickup` (origin) and may pass through an intermediate
airport (preferably one with a warehouse, enabling `hold` at a facility).
Passenger chains start at `check_in` (origin) and run directly to the
destination; passengers with oracle status `booked` emit no events. `load`,
`board`, `depart`, `arrive`, and `deliver` events reference the carrying
aircraft vehicle; `hold` references a warehouse facility; `actor_id` is a
ground-crew member for pickup/load/hold/deliver/check_in and a flight-crew
member for board/depart/arrive/disembark (null when the operator has no such
staff). `sequence` is per-subject 1..n and `valid_time` is a strictly
increasing datetime along the chain. Chain continuity (event N `from_state`
== event N-1 `to_state`) is asserted during generation.

## Usage

```
assetic-datagen generate [--seed 42] [--out DIR] [--as-of DATE]
                          [--window-days 365] [--scale small|medium|large]
                          [--num-operators N] [--num-vehicles N] ...
                          [--airports-source embedded|cache] [--cache-dir DIR]
```

Determinism: the same `--seed` always produces byte-identical output. The
generation window is anchored to a seed-derived date (not the wall clock),
so reruns on different days match; pass `--as-of YYYY-MM-DD` to pin it
explicitly. Generation never touches the network.
`--scale small|medium|large` applies 0.5x/1x/3x to the default counts
(operators 8, vehicles 30, staff 60, facilities 12, customers 10, cargo 80,
routes 25, orders 30, passengers 40); any `--num-X` flag overrides the scaled default for
that entity.

### Airport reference data

An embedded curated set (~37 major NA/EU airports) ships inside the package.
To use the full remote set, refresh the cache first (curated set then acts as
the offline fallback):

```
assetic-datagen refresh-airports [--source ourairports|openflights] [--cache-dir DIR]
assetic-datagen generate --airports-source cache
```

- Default source: OurAirports (`airports.csv`), filtered to North American and
  European countries, large/medium airports, capped at 200.
- The cache lives at `$XDG_CACHE_HOME/assetic-datagen/airports.json`
  (default `~/.cache/assetic-datagen/airports.json`) and is written atomically.
- `generate` defaults to `--airports-source cache`: cache if present and
  valid, embedded set otherwise. A corrupt cache is ignored with a warning.
- Remote-sourced airports carry a `country_code` but `country` is the code
  (the OurAirports CSV has no country-name column) and `timezone` may be
  `UTC`; the curated set has full names and real IANA timezones.

## Development

```
cd assetic/tools/datagen
pip install -e .
assetic-datagen generate --seed 42 --out /tmp/datagen-a
```

Zero runtime dependencies; Python ≥ 3.11.