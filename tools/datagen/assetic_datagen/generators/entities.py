"""Entity generators. Each returns a list of dict records (JSONL lines).

Generation order matters: later generators reference entities produced by
earlier ones (operators → vehicles → ownership → staff → facilities →
customers → cargo).
"""

from __future__ import annotations

import datetime as dt
import random
from typing import Any

from ..ids import IdAssigner
from ..rng import iso, random_date_in_window, window_start

SCHEMA_VERSION = 1

# Registration prefixes plausible for each operator home country.
_REG_PREFIX_BY_COUNTRY = {
    "United States": "N",
    "Canada": "C-F",
    "Mexico": "XA",
    "United Kingdom": "G-",
    "Ireland": "EI-",
    "France": "F-G",
    "Netherlands": "PH-",
    "Belgium": "OO-",
    "Germany": "D-A",
    "Spain": "EC-",
    "Portugal": "CS-",
    "Italy": "I-",
    "Switzerland": "HB-",
    "Austria": "OE-",
    "Denmark": "OY-",
    "Sweden": "SE-",
    "Norway": "LN-",
    "Finland": "OH-",
    "Türkiye": "TC-",
}


def _country_of(airport: dict[str, Any]) -> str:
    return airport["country"]


def generate_operators(
    rng: random.Random, ids: IdAssigner, pools: dict[str, Any],
    airports: list[dict[str, Any]], n: int, anchor: dt.date, window_days: int,
) -> list[dict[str, Any]]:
    operators: list[dict[str, Any]] = []
    used_names: set[str] = set()
    types = ["passenger", "cargo", "military"]
    start = window_start(anchor, window_days)
    for i in range(n):
        op_type = types[i % 3] if i < 3 else rng.choice(types)
        while True:
            name = f"{rng.choice(pools['airline_prefixes'])} {rng.choice(pools['airline_suffixes'][op_type])}"
            if name not in used_names:
                used_names.add(name)
                break
        hub = rng.choice(airports)
        operators.append({
            "operator_id": ids.next("opr"),
            "schema_version": SCHEMA_VERSION,
            "name": name,
            "type": op_type,
            "country": _country_of(hub),
            "hub_iata": hub["iata"],
            "founded_year": rng.randint(1965, 2018),
            "fleet_size_hint": rng.randint(5, 120),
            "generated_at": iso(anchor),
        })
    return operators


def generate_vehicles(
    rng: random.Random, ids: IdAssigner, pools: dict[str, Any],
    operators: list[dict[str, Any]], models: list[dict[str, Any]],
    airports: list[dict[str, Any]], n: int, anchor: dt.date,
) -> list[dict[str, Any]]:
    by_type = {"passenger": [], "cargo": [], "military": []}
    for op in operators:
        by_type[op["type"]].append(op)

    freighters = [m for m in models if m["category"].endswith("freighter")]
    pax_models = [m for m in models if m["category"].endswith(("narrowbody", "widebody"))]

    vehicles: list[dict[str, Any]] = []
    n_aircraft = max(1, round(n * 0.7))
    n_gse = max(1, round(n * 0.2))
    n_rail = max(0, n - n_aircraft - n_gse)

    for i in range(n_aircraft):
        op = _pick_operator(rng, by_type)
        if op["type"] == "cargo":
            model = rng.choice(freighters)
        elif op["type"] == "military":
            model = rng.choice(models)
        else:
            model = rng.choice(pax_models)
        base = _airport_near(rng, airports, op["hub_iata"])
        vehicles.append({
            "vehicle_id": ids.next("veh"),
            "kind": "aircraft",
            "registration": _registration(rng, _country_of(base), op["type"]),
            "model_id": model["model_id"],
            "operator_id": op["operator_id"],
            "status": rng.choices(["active", "maintenance", "stored"], weights=[75, 15, 10])[0],
            "seat_config": _seat_config(rng, model, op["type"]),
            "base_iata": base["iata"],
            "schema_version": SCHEMA_VERSION,
            "generated_at": iso(anchor),
        })

    for _ in range(n_gse):
        op = _pick_operator(rng, by_type)
        vehicles.append({
            "vehicle_id": ids.next("veh"),
            "kind": "ground_support",
            "gse_type": rng.choice(pools["gse_types"]),
            "operator_id": op["operator_id"],
            "home_iata": _airport_near(rng, airports, op["hub_iata"])["iata"],
            "schema_version": SCHEMA_VERSION,
            "generated_at": iso(anchor),
        })

    for _ in range(n_rail):
        op = _pick_operator(rng, by_type)
        vehicles.append({
            "vehicle_id": ids.next("veh"),
            "kind": "rail",
            "rail_type": rng.choice(pools["rail_types"]),
            "operator_id": op["operator_id"],
            "base_iata": _airport_near(rng, airports, op["hub_iata"])["iata"],
            "schema_version": SCHEMA_VERSION,
            "generated_at": iso(anchor),
        })

    # keep only what the caller asked for
    return vehicles[:n] if len(vehicles) > n else vehicles


def _pick_operator(rng: random.Random, by_type: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    non_empty = {t: ops for t, ops in by_type.items() if ops}
    return rng.choice(non_empty[rng.choice(sorted(non_empty))])


def _airport_near(rng: random.Random, airports: list[dict[str, Any]], hub_iata: str) -> dict[str, Any]:
    """Mostly the hub, sometimes another airport (same data set)."""
    if rng.random() < 0.7:
        for a in airports:
            if a["iata"] == hub_iata:
                return a
    return rng.choice(airports)


def _registration(rng: random.Random, country: str, op_type: str) -> str:
    prefix = _REG_PREFIX_BY_COUNTRY.get(country, "N")
    letters = "ABCDEFGHJKLMNRSTUVWXZ"
    if prefix in ("N", "C-F"):
        digits = f"{rng.randint(100, 999)}{rng.choice(letters)}{rng.choice(letters)}"
        return f"{prefix}{digits}" if prefix == "N" else f"{prefix}{digits}"
    return f"{prefix}{rng.choice(letters)}{rng.choice(letters)}{rng.choice(letters)}{rng.choice(letters)}"


def _seat_config(rng: random.Random, model: dict[str, Any], op_type: str) -> int | dict[str, int]:
    if op_type == "cargo" or model["pax_capacity_typical"] == 0:
        return {"y": 0}
    cap = model["pax_capacity_typical"]
    if op_type == "military":
        return {"troop_seats": cap}
    first = max(0, round(cap * rng.uniform(0.05, 0.15)))
    return {"f": first, "y": cap - first}


def generate_ownership_history(
    rng: random.Random, vehicles: list[dict[str, Any]],
    operators: list[dict[str, Any]], anchor: dt.date, window_days: int,
) -> list[dict[str, Any]]:
    """Sales/leases between operators for ~30% of vehicles.

    Chain invariants: record k+1's ``from_operator_id`` == record k's
    ``to_operator_id``; ``valid_time`` strictly increases; the final record's
    ``to_operator_id`` equals the vehicle's current ``operator_id``.
    """
    by_type: dict[str, list[dict[str, Any]]] = {"passenger": [], "cargo": [], "military": []}
    for op in operators:
        by_type[op["type"]].append(op)
    op_by_id = {op["operator_id"]: op for op in operators}
    start = window_start(anchor, window_days)

    records: list[dict[str, Any]] = []
    for veh in vehicles:
        if rng.random() >= 0.30:
            continue
        current = op_by_id[veh["operator_id"]]
        veh_type = current["type"]
        # build the chain backwards from the current operator
        chain_len = rng.randint(1, 3)
        hops: list[dict[str, Any]] = []
        cursor = current
        ok = True
        for _ in range(chain_len):
            candidates = [o for o in by_type[veh_type] if o["operator_id"] != cursor["operator_id"]]
            if not candidates:
                ok = False
                break
            prev_op = rng.choice(candidates)
            transfer = rng.choices(
                ["lease_start", "purchase", "sale"],
                weights=[45, 30, 25],
            )[0]
            # lease_start/purchase flow prev -> cursor; sale records cursor selling to prev is invalid,
            # so a "sale" hop is expressed as the purchase of the vehicle by the next owner (prev -> cursor).
            hops.append({
                "from_operator_id": prev_op["operator_id"],
                "to_operator_id": cursor["operator_id"],
                "transfer_type": "lease_start" if transfer == "lease_start" else "purchase",
            })
            cursor = prev_op
        if not ok or not hops:
            continue
        hops.reverse()  # chronological order: first transfer earliest
        # last hop must END at the current operator
        if hops[-1]["to_operator_id"] != current["operator_id"]:
            continue
        # assign strictly increasing valid_times within the window
        times = sorted(rng.sample(range((anchor - start).days), len(hops)))
        for seq, (hop, day_offset) in enumerate(zip(hops, times), start=1):
            records.append({
                "vehicle_id": veh["vehicle_id"],
                "sequence": seq,
                "from_operator_id": hop["from_operator_id"],
                "to_operator_id": hop["to_operator_id"],
                "transfer_type": hop["transfer_type"],
                "valid_time": iso(start + dt.timedelta(days=day_offset)),
            })
    return records


def generate_staff(
    rng: random.Random, ids: IdAssigner, pools: dict[str, Any],
    operators: list[dict[str, Any]], airports: list[dict[str, Any]],
    n: int, anchor: dt.date, window_days: int,
) -> list[dict[str, Any]]:
    flight_roles = ["captain", "first_officer", "cabin_lead", "cabin_crew"]
    ground_roles = ["ramp_agent", "baggage_handler", "maintenance_tech", "fueler"]
    management_roles = ["account_manager", "trip_manager"]
    passenger_ops = [op for op in operators if op["type"] in ("passenger", "military")]

    staff: list[dict[str, Any]] = []
    for _ in range(n):
        role_class = rng.choices(
            ["flight_crew", "ground_crew", "management"],
            weights=[40, 45, 15],
        )[0]
        if role_class == "flight_crew" and not passenger_ops:
            role_class = "ground_crew"
        if role_class == "flight_crew":
            op = rng.choice(passenger_ops)
            role = rng.choice(flight_roles)
        elif role_class == "management":
            op = rng.choice(operators)
            role = rng.choice(management_roles)
        else:
            op = rng.choice(operators)
            role = rng.choice(ground_roles)
        certs = rng.sample(pools["certifications_by_role"][role], k=rng.randint(2, min(4, len(pools["certifications_by_role"][role]))))
        staff.append({
            "staff_id": ids.next("sta"),
            "given_name": rng.choice(pools["given_names"]),
            "family_name": rng.choice(pools["family_names"]),
            "role_class": role_class,
            "role": role,
            "operator_id": op["operator_id"],
            "base_iata": _airport_near(rng, airports, op["hub_iata"])["iata"],
            "hire_date": iso(random_date_in_window(rng, window_start(anchor, window_days), anchor)),
            "certifications": sorted(certs),
            "schema_version": SCHEMA_VERSION,
            "generated_at": iso(anchor),
        })
    return staff


def generate_facilities(
    rng: random.Random, ids: IdAssigner, operators: list[dict[str, Any]],
    airports: list[dict[str, Any]], n: int, anchor: dt.date,
) -> list[dict[str, Any]]:
    facilities: list[dict[str, Any]] = []
    for _ in range(n):
        op = rng.choice(operators)
        facilities.append({
            "facility_id": ids.next("fac"),
            "facility_type": rng.choice(["hangar", "warehouse"]),
            "operator_id": op["operator_id"],
            "airport_iata": _airport_near(rng, airports, op["hub_iata"])["iata"],
            "capacity_units": rng.randint(2, 30),
            "schema_version": SCHEMA_VERSION,
            "generated_at": iso(anchor),
        })
    return facilities


def generate_carrier_customers(
    rng: random.Random, ids: IdAssigner, pools: dict[str, Any],
    operators: list[dict[str, Any]], account_managers: list[dict[str, Any]],
    n: int, anchor: dt.date, window_days: int,
) -> list[dict[str, Any]]:
    """Customers: cargo shippers and charter passenger-group clients.

    Each customer is assigned a responsible account manager (staff with
    role=account_manager at the contracted operator), matching the assetic
    ABAC model where account managers are scoped to assigned customers.
    """
    cargo_ops = [op for op in operators if op["type"] == "cargo"]
    charter_ops = [op for op in operators if op["type"] in ("passenger", "cargo")]
    if not cargo_ops:
        cargo_ops = operators  # degenerate small fleets: any operator contracts
    if not charter_ops:
        charter_ops = operators
    am_by_op: dict[str, list[str]] = {}
    for am in account_managers:
        am_by_op.setdefault(am["operator_id"], []).append(am["staff_id"])

    customers: list[dict[str, Any]] = []
    for i in range(n):
        if i % 4 == 3:  # ~25% charter clients
            op = rng.choice(charter_ops)
            customers.append({
                "customer_id": ids.next("cus"),
                "customer_type": "charter",
                "company_name": f"{rng.choice(pools['charter_company_roots'])} {rng.choice(pools['charter_company_suffixes'])}",
                "operator_id": op["operator_id"],
                "account_manager_id": rng.choice(am_by_op[op["operator_id"]]) if am_by_op.get(op["operator_id"]) else None,
                "contract_start": iso(random_date_in_window(rng, window_start(anchor, window_days), anchor)),
                "monthly_volume_kg": None,
                "schema_version": SCHEMA_VERSION,
                "generated_at": iso(anchor),
            })
        else:
            op = rng.choice(cargo_ops)
            customers.append({
                "customer_id": ids.next("cus"),
                "customer_type": "cargo_shipper",
                "company_name": f"{rng.choice(pools['customer_company_roots'])} {rng.choice(pools['customer_company_suffixes'])}",
                "operator_id": op["operator_id"],
                "account_manager_id": rng.choice(am_by_op[op["operator_id"]]) if am_by_op.get(op["operator_id"]) else None,
                "contract_start": iso(random_date_in_window(rng, window_start(anchor, window_days), anchor)),
                "monthly_volume_kg": rng.randint(2000, 250000),
                "schema_version": SCHEMA_VERSION,
                "generated_at": iso(anchor),
            })
    return customers


def generate_cargo(
    rng: random.Random, ids: IdAssigner, vehicles: list[dict[str, Any]],
    operators: list[dict[str, Any]], customers: list[dict[str, Any]],
    airports: list[dict[str, Any]], n: int, anchor: dt.date, window_days: int,
) -> list[dict[str, Any]]:
    # cargo-capable aircraft only: aircraft kind with real cargo capacity, cargo/military operator
    model_by_id = None  # resolved by caller via models list
    cargo_ops = {op["operator_id"] for op in operators if op["type"] in ("cargo", "military")}
    candidates = [
        v for v in vehicles
        if v["kind"] == "aircraft" and v["operator_id"] in cargo_ops
    ]
    shipments: list[dict[str, Any]] = []
    for _ in range(n):
        origin, dest = rng.sample(airports, 2)
        veh = rng.choice(candidates) if candidates else None
        rec = {
            "cargo_id": ids.next("cgo"),
            "customer_id": rng.choice(customers)["customer_id"],
            "operator_id": veh["operator_id"] if veh else rng.choice(sorted(cargo_ops))["operator_id"] if cargo_ops else None,
            "origin_iata": origin["iata"],
            "destination_iata": dest["iata"],
            "assigned_vehicle_id": veh["vehicle_id"] if veh else None,
            "weight_kg": rng.randint(50, 20000),
            "cargo_type": rng.choices(
                ["general", "perishable", "pharma", "hazmat", "oversize"],
                weights=[55, 15, 10, 10, 10],
            )[0],
            "status": rng.choices(
                ["scheduled", "loaded", "in_transit", "delivered"],
                weights=[20, 25, 25, 30],
            )[0],
            "valid_time": iso(random_date_in_window(rng, window_start(anchor, window_days), anchor)),
            "schema_version": SCHEMA_VERSION,
            "generated_at": iso(anchor),
        }
        if rec["operator_id"] is None:
            # no cargo operator exists; assign any operator to keep the reference valid
            rec["operator_id"] = operators[0]["operator_id"] if operators else None
            rec["assigned_vehicle_id"] = None
        shipments.append(rec)
    return shipments

def generate_routes(
    rng: random.Random, ids: IdAssigner, vehicles: list[dict[str, Any]],
    operators: list[dict[str, Any]], airports: list[dict[str, Any]],
    models: list[dict[str, Any]], cargo: list[dict[str, Any]],
    n: int, anchor: dt.date,
) -> list[dict[str, Any]]:
    """Planned travel routes for carriers.

    A route is an operator's scheduled itinerary for one aircraft vehicle on
    one operating day: an ordered list of legs (airport pair + scheduled
    departure/arrival times), anchored at the vehicle's base airport. Legs
    chain (leg i arrival airport = leg i+1 departure airport) and the route
    returns to base. Only passenger and cargo operators get routes; military
    operations are not represented as published carrier routes. Cargo
    routes use freighter-capable aircraft; cargo legs may reference an open
    cargo shipment, giving the route file a join point to cargo.jsonl.
    """
    model_by_id = {m["model_id"]: m for m in models}
    airport_by_iata = {a["iata"]: a for a in airports}
    eligible_ops = [op for op in operators if op["type"] in ("passenger", "cargo")]
    routes: list[dict[str, Any]] = []
    if not eligible_ops:
        return routes

    # aircraft vehicles grouped by operator
    aircraft_by_op: dict[str, list[dict[str, Any]]] = {}
    for veh in vehicles:
        if veh["kind"] == "aircraft":
            aircraft_by_op.setdefault(veh["operator_id"], []).append(veh)

    # operating days: the 14 days after the anchor (planned future travel)
    day_offsets = list(range(1, 15))
    # open cargo shipments per cargo operator, for optional leg references
    open_cargo_by_op: dict[str, list[str]] = {}
    for rec in cargo:
        if rec["status"] in ("scheduled", "loaded", "in_transit"):
            open_cargo_by_op.setdefault(rec["operator_id"], []).append(rec["cargo_id"])
    for i in range(n):
        op = eligible_ops[i % len(eligible_ops)] if i < len(eligible_ops) else rng.choice(eligible_ops)
        fleet = aircraft_by_op.get(op["operator_id"])
        if not fleet:
            continue
        veh = rng.choice(fleet)
        model = model_by_id.get(veh["model_id"], {})
        base = veh["base_iata"]
        # 2-5 legs; route starts and ends at the vehicle's base
        n_legs = rng.randint(2, 5)
        stops = [base]
        chosen = {base}
        pool = [a["iata"] for a in airports if a["iata"] != base]
        # model range gates which airports are reachable from the current stop
        range_km = model.get("range_km", 3000)
        limit = range_km * 0.9
        while len(stops) < n_legs:
            current = stops[-1]
            reachable = [iata for iata in pool
                         if iata not in chosen
                         and _great_circle_km(airport_by_iata[current], airport_by_iata[iata]) <= limit]
            # the final leg must return to base within range
            if len(stops) == n_legs - 1:
                reachable = [iata for iata in reachable
                             if _great_circle_km(airport_by_iata[iata], airport_by_iata[base]) <= limit]
            if not reachable:
                break  # aircraft range cannot support a longer chain; end the route here
            stop = rng.choice(reachable)
            stops.append(stop)
            chosen.add(stop)
        # if the loop broke early, drop trailing stops we cannot return to base from
        while len(stops) > 1 and _great_circle_km(airport_by_iata[stops[-1]], airport_by_iata[base]) > limit:
            stops.pop()
        if len(stops) < 2:
            continue  # nothing reachable from base within range; no route for this vehicle
        stops.append(base)  # route always returns to base
        day = anchor + dt.timedelta(days=rng.choice(day_offsets))
        dep = dt.datetime.combine(day, dt.time(rng.randint(5, 10), rng.choice([0, 15, 30, 45])))
        legs = []
        for seq, (a, b) in enumerate(zip(stops, stops[1:]), start=1):
            dist = _great_circle_km(airport_by_iata[a], airport_by_iata[b])
            flight_min = 30 + int(dist / 800 * 60)  # ~800 km/h cruise, 30 min taxi/turn
            arr = dep + dt.timedelta(minutes=flight_min)
            leg: dict[str, Any] = {
                "sequence": seq,
                "from_iata": a,
                "to_iata": b,
                "scheduled_departure": dep.isoformat(),
                "scheduled_arrival": arr.isoformat(),
            }
            if op["type"] == "cargo" and open_cargo_by_op.get(op["operator_id"]):
                # attach an open shipment reference occasionally
                if rng.random() < 0.4:
                    leg["cargo_ref"] = rng.choice(open_cargo_by_op[op["operator_id"]])
            legs.append(leg)
            dep = arr + dt.timedelta(minutes=rng.randint(45, 120))  # turnaround
        routes.append({
            "route_id": ids.next("rte"),
            "operator_id": op["operator_id"],
            "vehicle_id": veh["vehicle_id"],
            "route_type": op["type"],
            "base_iata": base,
            "legs": legs,
            "schema_version": SCHEMA_VERSION,
            "generated_at": iso(anchor),
        })
    return routes


def _great_circle_km(a: dict[str, Any], b: dict[str, Any]) -> float:
    """Haversine great-circle distance in km."""
    import math

    lat1, lon1, lat2, lon2 = a["latitude"], a["longitude"], b["latitude"], b["longitude"]
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    h = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))

def generate_orders(
    rng: random.Random, ids: IdAssigner, pools: dict[str, Any],
    customers: list[dict[str, Any]], routes: list[dict[str, Any]],
    staff: list[dict[str, Any]], aircraft_by_model: dict[str, list[dict[str, Any]]] | None,
    airports: list[dict[str, Any]], models: list[dict[str, Any]],
    n: int, anchor: dt.date, window_days: int,
) -> list[dict[str, Any]]:
    """Customer orders: charter passenger groups and/or cargo bookings.

    An order is a customer request to move people and/or freight from an
    origin to a destination, which may require multiple transits/flights.
    The generated itinerary chains route legs from routes.jsonl (matching
    operator and airports) when possible, producing multi-transit itineraries;
    otherwise it plans direct legs on plausible aircraft. Each order carries
    a responsible account manager (from the customer's assignment) and the
    trip manager at the fulfilling operator who schedules the assignment.
    """
    airport_by_iata = {a["iata"]: a for a in airports}
    routes_by_op: dict[str, list[dict[str, Any]]] = {}
    for rt in routes:
        routes_by_op.setdefault(rt["operator_id"], []).append(rt)
    trip_managers_by_op: dict[str, list[str]] = {}
    for s in staff:
        if s["role"] == "trip_manager":
            trip_managers_by_op.setdefault(s["operator_id"], []).append(s["staff_id"])
    pax_models = [m for m in models if m["pax_capacity_typical"] > 0]
    cargo_models = [m for m in models if m["cargo_capacity_kg"] > 0]

    orders: list[dict[str, Any]] = []
    for _ in range(n):
        customer = rng.choice(customers)
        op_id = customer["operator_id"]
        is_charter = customer["customer_type"] == "charter"
        origin, dest = rng.sample(airports, 2)
        order_date = random_date_in_window(rng, window_start(anchor, window_days), anchor)

        # itinerary: chain route legs (multi-transit) or plan direct legs
        transit_ids: list[str] = []
        planned_legs: list[dict[str, Any]] = []
        op_routes = routes_by_op.get(op_id, [])
        # walk the operator's routes from origin toward dest, chaining legs;
        # cursor is initialized unconditionally so it never leaks from a
        # prior loop iteration when this operator has no routes. Only legs
        # departing after the previous arrival are chained, and no airport
        # is visited twice, so itineraries are temporally consistent and
        # non-cyclic.
        cursor = origin["iata"]
        visited = {origin["iata"]}
        last_arrival: dt.datetime | None = None
        hops = 0
        while op_routes and cursor != dest["iata"] and hops < 4:
            matching = [
                (rt, leg) for rt in op_routes for leg in rt["legs"]
                if leg["from_iata"] == cursor
                and leg["to_iata"] not in visited
                and (last_arrival is None or dt.datetime.fromisoformat(leg["scheduled_departure"]) > last_arrival)
            ]
            if not matching:
                break
            # prefer a leg heading to dest; otherwise any onward leg
            toward_dest = [m for m in matching if m[1]["to_iata"] == dest["iata"]]
            rt, leg = rng.choice(toward_dest or matching)
            transit_ids.append(rt["route_id"])
            planned_legs.append({
                "leg_sequence": len(planned_legs) + 1,
                "from_iata": leg["from_iata"],
                "to_iata": leg["to_iata"],
                "scheduled_departure": leg["scheduled_departure"],
                "scheduled_arrival": leg["scheduled_arrival"],
            })
            visited.add(leg["to_iata"])
            last_arrival = dt.datetime.fromisoformat(leg["scheduled_arrival"])
            cursor = leg["to_iata"]
            hops += 1
        if cursor != dest["iata"]:
            # chain could not reach the destination within the hop limit
            # (or no chainable routes): close the gap with a final direct leg
            pool = pax_models if is_charter else cargo_models
            model = rng.choice(pool)
            if planned_legs:
                dep = dt.datetime.fromisoformat(planned_legs[-1]["scheduled_arrival"]) + dt.timedelta(hours=rng.randint(2, 24))
            else:
                dep = dt.datetime.combine(order_date, dt.time(rng.randint(6, 18), rng.choice([0, 15, 30, 45])))
            dist = _great_circle_km(airport_by_iata[cursor], dest)
            flight_min = 30 + int(dist / 800 * 60)
            planned_legs.append({
                "leg_sequence": len(planned_legs) + 1,
                "from_iata": cursor,
                "to_iata": dest["iata"],
                "scheduled_departure": dep.isoformat(),
                "scheduled_arrival": (dep + dt.timedelta(minutes=flight_min)).isoformat(),
            })

        # cargo details for cargo-bearing orders
        has_cargo = (not is_charter) or (rng.random() < 0.3)
        order: dict[str, Any] = {
            "order_id": ids.next("ord"),
            "customer_id": customer["customer_id"],
            "operator_id": op_id,
            "order_type": "charter_passenger" if is_charter else "cargo",
            "account_manager_id": customer.get("account_manager_id"),
            "trip_manager_id": rng.choice(trip_managers_by_op[op_id]) if trip_managers_by_op.get(op_id) else None,
            "origin_iata": origin["iata"],
            "destination_iata": dest["iata"],
            "planned_legs": planned_legs,
            "transit_route_ids": transit_ids,
            "ordered_on": iso(order_date),
            "status": rng.choices(
                ["requested", "confirmed", "in_progress", "completed"],
                weights=[25, 35, 25, 15],
            )[0],
            "schema_version": SCHEMA_VERSION,
            "generated_at": iso(anchor),
        }
        if is_charter:
            order["passenger_group"] = {
                "group_name": rng.choice(pools["charter_group_names"]),
                "pax_count": rng.randint(20, 180),
            }
            if has_cargo:
                order["accompanying_cargo_kg"] = rng.randint(200, 8000)
        else:
            order["freight"] = {
                "weight_kg": rng.randint(500, 45000),
                "cargo_type": rng.choice(pools["cargo_types"]),
            }
        orders.append(order)
    return orders