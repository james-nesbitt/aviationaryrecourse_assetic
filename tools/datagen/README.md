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
| `cargo_journey_events.jsonl` | per-shipment location-tracking event chains (pickup → delivered) |
| `passenger_boarding_events.jsonl` | per-passenger boarding/location event chains (check-in → disembarked) |
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
checked_in/boarded/in_transit/arrived/disembarked (15/25/25/25/10).

### Cargo journey event semantics

Each cargo shipment emits a strictly-increasing chain of location-tracking
events (`cargo_journey_events.jsonl`), starting with `pickup` at the origin
airport. The chain depth reflects the shipment `status`:

| status | chain |
| `scheduled` | `pickup` (at origin) |
| `loaded` | `pickup` → `loaded` (origin, with vehicle) |
| `in_transit` | `pickup` → `loaded` → `departed` (+ optional `arrived` at an intermediate airport) |
| `delivered` | `pickup` → `loaded` → `departed` → (optional `arrived`) → (optional `warehouse_hold` at a warehouse facility, optionally followed by `transferred`) → `delivered` (at destination) |

`warehouse_hold` events reference a warehouse facility at the arrival airport
when one exists; `loaded`/`departed`/`arrived` events reference the carrying
aircraft vehicle; `actor_id` is a ground-crew staff member at the fulfilling
operator (null when that operator has no ground crew). `sequence` is
per-cargo 1..n and `valid_time` is a strictly increasing datetime along the
chain.

### Passenger boarding event semantics

Each passenger emits a strictly-increasing chain of boarding/location events
(`passenger_boarding_events.jsonl`), starting with `checked_in` at the origin
airport. The chain depth reflects the passenger `status`:

| status | chain |
| `checked_in` | `checked_in` (origin) |
| `boarded` | `checked_in` → `boarded` (origin, with vehicle) |
| `in_transit` | `checked_in` → `boarded` → `departed` |
| `arrived` | `checked_in` → `boarded` → `departed` → `arrived` (destination) |
| `disembarked` | `checked_in` → `boarded` → `departed` → `arrived` → `disembarked` (destination) |

`boarded`/`departed`/`arrived` events reference the carrying aircraft vehicle;
`actor_id` is a flight-crew member for boarding/departure/arrival/disembarking
and a ground-crew member for check-in (null when the carrying operator has no
such staff). `sequence` is per-passenger 1..n and `valid_time` is a strictly
increasing datetime along the chain.

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