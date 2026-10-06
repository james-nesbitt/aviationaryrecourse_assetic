"""Entity generators. Each returns a list of dict records (JSONL lines).

Generation order matters: later generators reference entities produced by
earlier ones (operators → vehicles → ownership → staff → facilities →
customers → routes → maintenance → assignments → operations → cargo →
orders → passengers → transit events).
"""

from __future__ import annotations

import datetime as dt
import random
from typing import Any

from ..ids import IdAssigner
from ..rng import anchor_instant, iso, random_date_in_window, window_start

SCHEMA_VERSION = 1

# How far past the anchor the future horizon extends: operations,
# maintenance windows and assignments are generated up to anchor + FUTURE_DAYS.
FUTURE_DAYS = 14

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
            # maintenance status is derived later from maintenance windows
            "status": rng.choices(["active", "stored"], weights=[85, 15])[0],
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


def generate_routes(
    rng: random.Random, ids: IdAssigner, vehicles: list[dict[str, Any]],
    operators: list[dict[str, Any]], airports: list[dict[str, Any]],
    models: list[dict[str, Any]], n: int, anchor: dt.date, window_days: int,
) -> list[dict[str, Any]]:
    """Planned recurring travel routes for carriers.

    A route is an operator's recurring itinerary pattern for one aircraft
    vehicle: an ordered list of legs (airport pair + the scheduled times of
    the FIRST operation), anchored at the vehicle's base airport. Legs
    chain (leg i arrival airport = leg i+1 departure airport) and the
    route returns to base. The route operates every ``frequency_days``
    starting at ``first_operating_date``; dated executions live in
    route_operations.jsonl. Only passenger and cargo operators get
    routes. Cargo routes use freighter-capable aircraft.
    """
    model_by_id = {m["model_id"]: m for m in models}
    airport_by_iata = {a["iata"]: a for a in airports}
    eligible_ops = [op for op in operators if op["type"] in ("passenger", "cargo")]
    routes: list[dict[str, Any]] = []
    if not eligible_ops:
        return routes

    # non-stored aircraft vehicles grouped by operator
    aircraft_by_op: dict[str, list[dict[str, Any]]] = {}
    for veh in vehicles:
        if veh["kind"] == "aircraft" and veh["status"] != "stored":
            aircraft_by_op.setdefault(veh["operator_id"], []).append(veh)

    # one route per vehicle while the fleet allows it
    used: set[str] = set()
    for i in range(n):
        op = eligible_ops[i % len(eligible_ops)] if i < len(eligible_ops) else rng.choice(eligible_ops)
        fleet = aircraft_by_op.get(op["operator_id"])
        if not fleet:
            continue
        free = [v for v in fleet if v["vehicle_id"] not in used]
        veh = rng.choice(free or fleet)
        used.add(veh["vehicle_id"])
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
        first_operating_date = window_start(anchor, window_days) + dt.timedelta(days=rng.randint(0, 30))
        dep = dt.datetime.combine(first_operating_date, dt.time(rng.randint(5, 10), rng.choice([0, 15, 30, 45])))
        legs = []
        for seq, (a, b) in enumerate(zip(stops, stops[1:]), start=1):
            dist = _great_circle_km(airport_by_iata[a], airport_by_iata[b])
            flight_min = 30 + int(dist / 800 * 60)  # ~800 km/h cruise, 30 min taxi/turn
            arr = dep + dt.timedelta(minutes=flight_min)
            legs.append({
                "sequence": seq,
                "from_iata": a,
                "to_iata": b,
                "scheduled_departure": dep.isoformat(),
                "scheduled_arrival": arr.isoformat(),
            })
            dep = arr + dt.timedelta(minutes=rng.randint(45, 120))  # turnaround
        routes.append({
            "route_id": ids.next("rte"),
            "operator_id": op["operator_id"],
            "vehicle_id": veh["vehicle_id"],
            "route_type": op["type"],
            "base_iata": base,
            "frequency_days": rng.choices([1, 2, 3, 7], weights=[40, 30, 20, 10])[0],
            "first_operating_date": iso(first_operating_date),
            "legs": legs,
            "schema_version": SCHEMA_VERSION,
            "generated_at": iso(anchor),
        })
    return routes


def generate_vehicle_maintenance(
    rng: random.Random, ids: IdAssigner, vehicles: list[dict[str, Any]],
    facilities: list[dict[str, Any]], anchor: dt.date, window_days: int,
) -> list[dict[str, Any]]:
    """Maintenance windows for active aircraft.

    Windows tile each aircraft's timeline from the generation window start
    up to ``anchor + FUTURE_DAYS`` at 60-180 day intervals. A vehicle's
    ``status`` in vehicles.jsonl becomes ``maintenance`` when one of its
    windows contains the anchor date.
    """
    hangars_by_op: dict[str, list[dict[str, Any]]] = {}
    all_hangars: list[dict[str, Any]] = []
    for f in facilities:
        if f["facility_type"] == "hangar":
            hangars_by_op.setdefault(f["operator_id"], []).append(f)
            all_hangars.append(f)

    records: list[dict[str, Any]] = []
    for veh in vehicles:
        if veh["kind"] != "aircraft" or veh["status"] == "stored":
            continue
        windows: list[dict[str, Any]] = []
        d = window_start(anchor, window_days) + dt.timedelta(days=rng.randint(0, 60))
        while True:
            d += dt.timedelta(days=rng.randint(60, 180))
            if d > anchor + dt.timedelta(days=FUTURE_DAYS):
                break
            mtype = rng.choices(
                ["a_check", "b_check", "c_check", "unscheduled"],
                weights=[45, 25, 10, 20],
            )[0]
            duration_days = {
                "a_check": (1, 2),
                "b_check": (3, 5),
                "c_check": (10, 21),
                "unscheduled": (1, 4),
            }[mtype]
            end = d + dt.timedelta(days=rng.randint(*duration_days) - 1)
            own = hangars_by_op.get(veh["operator_id"], [])
            at_base = [f for f in own if f["airport_iata"] == veh["base_iata"]]
            if at_base:
                facility = at_base[0]
            elif own:
                facility = rng.choice(own)
            elif all_hangars:
                facility = rng.choice(all_hangars)
            else:
                facility = None
            status = ("completed" if end < anchor
                      else "in_progress" if d <= anchor <= end
                      else "scheduled")
            rec = {
                "maintenance_id": ids.next("mnt"),
                "vehicle_id": veh["vehicle_id"],
                "facility_id": facility["facility_id"] if facility else None,
                "maintenance_type": mtype,
                "start_date": iso(d),
                "end_date": iso(end),
                "status": status,
                "schema_version": SCHEMA_VERSION,
                "generated_at": iso(anchor),
            }
            records.append(rec)
            windows.append(rec)
            d = end
        if any(w["start_date"] <= anchor.isoformat() <= w["end_date"] for w in windows):
            veh["status"] = "maintenance"
    return records


def generate_route_assignments(
    rng: random.Random, ids: IdAssigner, routes: list[dict[str, Any]],
    vehicles: list[dict[str, Any]], maintenance: list[dict[str, Any]],
    anchor: dt.date,
) -> list[dict[str, Any]]:
    """Which vehicle operates each route over which date interval.

    Per route the intervals are contiguous and non-overlapping: the first
    starts at ``first_operating_date`` (reason ``initial``) and the last is
    open (``valid_to`` is null). Vehicles occasionally swap routes within
    an operator; when a vehicle enters maintenance, another aircraft of
    the same operator covers the affected interval, otherwise the
    overlapping operations are cancelled.
    """
    first_by_route = {rt["route_id"]: dt.date.fromisoformat(rt["first_operating_date"]) for rt in routes}
    # internal segment representation: {vehicle_id, start, end, reason, replaces}
    segments: dict[str, list[dict[str, Any]]] = {}
    for rt in routes:
        segments[rt["route_id"]] = [{
            "vehicle_id": rt["vehicle_id"], "start": first_by_route[rt["route_id"]],
            "end": None, "reason": "initial", "replaces": None,
        }]

    routes_by_op: dict[str, list[dict[str, Any]]] = {}
    for rt in routes:
        routes_by_op.setdefault(rt["operator_id"], []).append(rt)

    # --- swaps: two routes of one operator exchange vehicles from a date ---
    for op_routes in routes_by_op.values():
        if len(op_routes) < 2:
            continue
        for _ in range(len(op_routes)):
            if rng.random() >= 0.15:
                continue
            a, b = rng.sample(op_routes, 2)
            lo = max(first_by_route[a["route_id"]], first_by_route[b["route_id"]]) + dt.timedelta(days=7)
            hi = anchor + dt.timedelta(days=FUTURE_DAYS)
            if lo > hi:
                continue
            day = lo + dt.timedelta(days=rng.randint(0, (hi - lo).days))
            open_a = [s for s in segments[a["route_id"]] if s["end"] is None]
            open_b = [s for s in segments[b["route_id"]] if s["end"] is None]
            if not open_a or not open_b:
                continue
            va, vb = open_a[0]["vehicle_id"], open_b[0]["vehicle_id"]
            if va == vb or open_a[0]["start"] >= day or open_b[0]["start"] >= day:
                continue
            open_a[0]["end"] = day - dt.timedelta(days=1)
            open_b[0]["end"] = day - dt.timedelta(days=1)
            segments[a["route_id"]].append(
                {"vehicle_id": vb, "start": day, "end": None, "reason": "swap", "replaces": va})
            segments[b["route_id"]].append(
                {"vehicle_id": va, "start": day, "end": None, "reason": "swap", "replaces": vb})

    # --- maintenance cover: another aircraft covers the grounded interval ---
    vehicle_by_id = {v["vehicle_id"]: v for v in vehicles}
    aircraft_by_op: dict[str, list[dict[str, Any]]] = {}
    for v in vehicles:
        if v["kind"] == "aircraft" and v["status"] != "stored":
            aircraft_by_op.setdefault(v["operator_id"], []).append(v)
    windows_by_vehicle: dict[str, list[dict[str, Any]]] = {}
    for w in maintenance:
        windows_by_vehicle.setdefault(w["vehicle_id"], []).append(w)

    def busy_with_maintenance(vid: str, o_start: dt.date, o_end: dt.date) -> bool:
        return any(
            dt.date.fromisoformat(x["start_date"]) <= o_end
            and dt.date.fromisoformat(x["end_date"]) >= o_start
            for x in windows_by_vehicle.get(vid, [])
        )

    def holds_segment(vid: str, o_start: dt.date, o_end: dt.date) -> bool:
        return any(
            sg["vehicle_id"] == vid
            and sg["start"] <= o_end
            and (sg["end"] is None or sg["end"] >= o_start)
            for rsegs in segments.values() for sg in rsegs
        )

    for w in sorted(maintenance, key=lambda w: (w["start_date"], w["maintenance_id"])):
        veh = vehicle_by_id.get(w["vehicle_id"])
        if veh is None:
            continue
        w_start = dt.date.fromisoformat(w["start_date"])
        w_end = dt.date.fromisoformat(w["end_date"])
        for rt in routes_by_op.get(veh["operator_id"], []):
            segs = segments[rt["route_id"]]
            for s in list(segs):
                if s["vehicle_id"] != w["vehicle_id"]:
                    continue
                if s["start"] > w_end or (s["end"] is not None and s["end"] < w_start):
                    continue  # segment does not overlap this window
                o_start = max(s["start"], w_start)
                o_end = min(s["end"], w_end) if s["end"] is not None else w_end
                candidates = [
                    v["vehicle_id"] for v in aircraft_by_op.get(veh["operator_id"], [])
                    if v["vehicle_id"] != w["vehicle_id"]
                    and not busy_with_maintenance(v["vehicle_id"], o_start, o_end)
                ]
                if not candidates:
                    continue  # no cover available: operations will be cancelled
                preferred = [vid for vid in candidates if not holds_segment(vid, o_start, o_end)]
                cover = rng.choice(preferred or candidates)
                replacement: list[dict[str, Any]] = []
                if s["start"] < o_start:
                    replacement.append({"vehicle_id": s["vehicle_id"], "start": s["start"],
                                        "end": o_start - dt.timedelta(days=1),
                                        "reason": s["reason"], "replaces": s["replaces"]})
                replacement.append({"vehicle_id": cover, "start": o_start, "end": o_end,
                                    "reason": "maintenance_cover", "replaces": w["vehicle_id"]})
                if s["end"] is None or s["end"] > o_end:
                    replacement.append({"vehicle_id": s["vehicle_id"], "start": o_end + dt.timedelta(days=1),
                                        "end": s["end"], "reason": "maintenance_return", "replaces": cover})
                segs.remove(s)
                segs.extend(replacement)
                segs.sort(key=lambda x: x["start"])

    # --- emit records, asserting the per-route interval invariants ---
    records: list[dict[str, Any]] = []
    for rt in routes:
        segs = sorted(segments[rt["route_id"]], key=lambda x: x["start"])
        first = first_by_route[rt["route_id"]]
        assert segs[0]["start"] == first, \
            f"route {rt['route_id']}: first assignment starts at {segs[0]['start']}, expected {first}"
        for prev, nxt in zip(segs, segs[1:]):
            assert nxt["start"] == prev["end"] + dt.timedelta(days=1), \
                f"route {rt['route_id']}: non-contiguous assignments at {nxt['start']}"
        assert segs[-1]["end"] is None, \
            f"route {rt['route_id']}: last assignment is closed"
        for s in segs:
            records.append({
                "assignment_id": ids.next("asg"),
                "route_id": rt["route_id"],
                "vehicle_id": s["vehicle_id"],
                "valid_from": iso(s["start"]),
                "valid_to": iso(s["end"]) if s["end"] is not None else None,
                "reason": s["reason"],
                "replaces_vehicle_id": s["replaces"],
                "schema_version": SCHEMA_VERSION,
                "generated_at": iso(anchor),
            })
    return records


def generate_route_operations(
    ids: IdAssigner, routes: list[dict[str, Any]],
    assignments: list[dict[str, Any]], maintenance: list[dict[str, Any]],
    anchor: dt.date,
) -> list[dict[str, Any]]:
    """One dated execution per route every ``frequency_days`` days.

    Fully determined by its inputs: each operation's legs are the route
    legs shifted to the operating date, its vehicle is the assignment
    active that day, and its status is derived from the anchor instant —
    or ``cancelled`` when the assigned vehicle is in maintenance that day
    (i.e. no cover was found).
    """
    horizon = anchor + dt.timedelta(days=FUTURE_DAYS)
    now = anchor_instant(anchor)
    by_route: dict[str, list[dict[str, Any]]] = {}
    for a in sorted(assignments, key=lambda a: a["valid_from"]):
        by_route.setdefault(a["route_id"], []).append(a)
    windows_by_vehicle: dict[str, list[dict[str, Any]]] = {}
    for w in maintenance:
        windows_by_vehicle.setdefault(w["vehicle_id"], []).append(w)

    operations: list[dict[str, Any]] = []
    for rt in routes:
        first = first_op_date = dt.date.fromisoformat(rt["first_operating_date"])
        segs = by_route.get(rt["route_id"], [])
        d = first
        while d <= horizon:
            active = [a for a in segs
                      if dt.date.fromisoformat(a["valid_from"]) <= d
                      and (a["valid_to"] is None or d <= dt.date.fromisoformat(a["valid_to"]))]
            assert len(active) == 1, \
                f"route {rt['route_id']}: {len(active)} assignments active on {d.isoformat()}"
            vehicle_id = active[0]["vehicle_id"]
            grounded = any(
                dt.date.fromisoformat(w["start_date"]) <= d <= dt.date.fromisoformat(w["end_date"])
                for w in windows_by_vehicle.get(vehicle_id, [])
            )
            delta = d - first
            legs = [{**leg,
                     "scheduled_departure": (dt.datetime.fromisoformat(leg["scheduled_departure"]) + delta).isoformat(),
                     "scheduled_arrival": (dt.datetime.fromisoformat(leg["scheduled_arrival"]) + delta).isoformat()}
                    for leg in rt["legs"]]
            if grounded:
                status = "cancelled"
            else:
                first_dep = dt.datetime.fromisoformat(legs[0]["scheduled_departure"])
                last_arr = dt.datetime.fromisoformat(legs[-1]["scheduled_arrival"])
                if last_arr < now:
                    status = "completed"
                elif first_dep <= now:
                    status = "in_progress"
                else:
                    status = "scheduled"
            operations.append({
                "operation_id": ids.next("rop"),
                "route_id": rt["route_id"],
                "vehicle_id": vehicle_id,
                "operator_id": rt["operator_id"],
                "operating_date": iso(d),
                "status": status,
                "legs": legs,
                "schema_version": SCHEMA_VERSION,
                "generated_at": iso(anchor),
            })
            d += dt.timedelta(days=rt["frequency_days"])
    return operations


def _choose_span(rng: random.Random, legs: list[dict[str, Any]]) -> tuple[int, int]:
    """1-based (board leg, alight leg) sequences for a booking."""
    n = len(legs)
    i = rng.randint(1, n)
    j = i if rng.random() < 0.6 else rng.randint(i, n)
    if legs[i - 1]["from_iata"] == legs[j - 1]["to_iata"]:
        j = i  # full loop back to base: stay on one leg
    return i, j


def generate_cargo(
    rng: random.Random, ids: IdAssigner, operations: list[dict[str, Any]],
    routes: list[dict[str, Any]], operators: list[dict[str, Any]],
    customers: list[dict[str, Any]], n: int, anchor: dt.date,
) -> list[dict[str, Any]]:
    """Cargo shipments booked onto concrete cargo-route operations.

    Each shipment rides one non-cancelled operation from a board leg to an
    alight leg, inheriting the operating vehicle and leg timetable. The
    customer prefers cargo shippers of the same operator. ``status`` is
    the oracle derived by the transit-event generator; board/alight leg
    sequences are generation provenance (JSONL only, not loaded).
    """
    route_type_by_id = {r["route_id"]: r["route_type"] for r in routes}
    bookable = [o for o in operations
                if o["status"] != "cancelled" and route_type_by_id[o["route_id"]] == "cargo"]
    if not bookable:
        raise SystemExit("datagen: no bookable cargo-operator route operations; increase --num-routes or --num-vehicles")

    shipments: list[dict[str, Any]] = []
    for _ in range(n):
        op = rng.choice(bookable)
        i, j = _choose_span(rng, op["legs"])
        legs = op["legs"]
        origin = legs[i - 1]["from_iata"]
        dest = legs[j - 1]["to_iata"]
        operator_id = op["operator_id"]
        pool = [c for c in customers
                if c["operator_id"] == operator_id and c["customer_type"] == "cargo_shipper"]
        if not pool:
            pool = [c for c in customers if c["operator_id"] == operator_id] or customers
        customer = rng.choice(pool)
        shipments.append({
            "cargo_id": ids.next("cgo"),
            "customer_id": customer["customer_id"],
            "operator_id": operator_id,
            "origin_iata": origin,
            "destination_iata": dest,
            "assigned_vehicle_id": op["vehicle_id"],
            "operation_id": op["operation_id"],
            "board_leg_sequence": i,
            "alight_leg_sequence": j,
            "weight_kg": rng.randint(50, 20000),
            "cargo_type": rng.choices(
                ["general", "perishable", "pharma", "hazmat", "oversize"],
                weights=[55, 15, 10, 10, 10],
            )[0],
            "status": None,  # oracle: set by the transit-event generator
            "valid_time": iso(dt.date.fromisoformat(op["operating_date"]) - dt.timedelta(days=rng.randint(1, 21))),
            "schema_version": SCHEMA_VERSION,
            "generated_at": iso(anchor),
        })
    return shipments


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
    customers: list[dict[str, Any]], operations: list[dict[str, Any]],
    staff: list[dict[str, Any]], aircraft_by_model: dict[str, list[dict[str, Any]]] | None,
    airports: list[dict[str, Any]], models: list[dict[str, Any]],
    n: int, anchor: dt.date, window_days: int,
) -> list[dict[str, Any]]:
    """Customer orders: charter passenger groups and/or cargo bookings.

    An order is a customer request to move people and/or freight from an
    origin to a destination, which may require multiple transits/flights.
    The generated itinerary chains legs from the operator's non-cancelled
    route operations (matching airports) when possible, producing
    multi-transit itineraries; otherwise it plans direct legs on plausible
    aircraft. Each order carries a responsible account manager (from the
    customer's assignment) and the trip manager at the fulfilling operator
    who schedules the assignment.
    """
    airport_by_iata = {a["iata"]: a for a in airports}
    # (operation, leg) pairs by operator and departure airport
    legs_by_op_from: dict[str, dict[str, list[tuple[dict[str, Any], dict[str, Any]]]]] = {}
    for o in operations:
        if o["status"] == "cancelled":
            continue
        by_from = legs_by_op_from.setdefault(o["operator_id"], {})
        for leg in o["legs"]:
            by_from.setdefault(leg["from_iata"], []).append((o, leg))
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

        # itinerary: chain operation legs (multi-transit) or plan direct legs
        transit_ids: list[str] = []
        planned_legs: list[dict[str, Any]] = []
        legs_by_from = legs_by_op_from.get(op_id, {})
        # walk the operator's operations from origin toward dest, chaining
        # legs; only legs departing after the previous arrival are chained,
        # and no airport is visited twice, so itineraries are temporally
        # consistent and non-cyclic.
        cursor = origin["iata"]
        visited = {origin["iata"]}
        last_arrival = dt.datetime.combine(order_date, dt.time(0, 0))
        hops = 0
        while legs_by_from and cursor != dest["iata"] and hops < 4:
            matching = [
                (o, leg) for o, leg in legs_by_from.get(cursor, [])
                if leg["to_iata"] not in visited
                and dt.datetime.fromisoformat(leg["scheduled_departure"]) > last_arrival
            ]
            if not matching:
                break
            # prefer a leg heading to dest; otherwise any onward leg
            toward_dest = [m for m in matching if m[1]["to_iata"] == dest["iata"]]
            operation, leg = rng.choice(toward_dest or matching)
            if operation["route_id"] not in transit_ids:
                transit_ids.append(operation["route_id"])
            planned_legs.append({
                "leg_sequence": len(planned_legs) + 1,
                "from_iata": leg["from_iata"],
                "to_iata": leg["to_iata"],
                "scheduled_departure": leg["scheduled_departure"],
                "scheduled_arrival": leg["scheduled_arrival"],
                "operation_id": operation["operation_id"],
            })
            visited.add(leg["to_iata"])
            last_arrival = dt.datetime.fromisoformat(leg["scheduled_arrival"])
            cursor = leg["to_iata"]
            hops += 1
        if cursor != dest["iata"]:
            # chain could not reach the destination within the hop limit
            # (or no chainable operations): close the gap with a final direct leg
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
def generate_passengers(
    rng: random.Random, ids: IdAssigner, pools: dict[str, Any],
    orders: list[dict[str, Any]], operations: list[dict[str, Any]],
    routes: list[dict[str, Any]], operators: list[dict[str, Any]],
    n: int, anchor: dt.date,
) -> list[dict[str, Any]]:
    """Passenger records booked onto concrete passenger-route operations.

    Charter-passenger orders materialize 2-3 passengers each (linked by
    ``order_id``), riding the operation of the order's first operation-
    backed planned leg. The remaining budget up to ``n`` is filled with
    standalone bookings round-robin over the operators that have bookable
    passenger operations. Passengers ride through: board at the origin
    leg, arrive at the destination leg, no intermediate events. The
    ``status`` oracle is derived by the transit-event generator;
    board/alight leg sequences are generation provenance.
    """
    route_type_by_id = {r["route_id"]: r["route_type"] for r in routes}
    bookable_pax = [o for o in operations
                    if o["status"] != "cancelled" and route_type_by_id[o["route_id"]] == "passenger"]
    if not bookable_pax:
        raise SystemExit("datagen: no bookable passenger-operator route operations; increase --num-routes or --num-vehicles")
    ops_by_id = {o["operation_id"]: o for o in operations}
    by_op: dict[str, list[dict[str, Any]]] = {}
    for o in bookable_pax:
        by_op.setdefault(o["operator_id"], []).append(o)

    def make(order_id: str | None, op: dict[str, Any], i: int, j: int) -> dict[str, Any]:
        legs = op["legs"]
        return {
            "passenger_id": ids.next("pax"),
            "given_name": rng.choice(pools["given_names"]),
            "family_name": rng.choice(pools["family_names"]),
            "passenger_type": rng.choices(
                ["adult", "child", "infant"], weights=[80, 15, 5],
            )[0],
            "order_id": order_id,
            "operator_id": op["operator_id"],
            "origin_iata": legs[i - 1]["from_iata"],
            "destination_iata": legs[j - 1]["to_iata"],
            "operation_id": op["operation_id"],
            "board_leg_sequence": i,
            "alight_leg_sequence": j,
            "status": None,  # oracle: set by the transit-event generator
            "valid_time": iso(dt.date.fromisoformat(op["operating_date"]) - dt.timedelta(days=rng.randint(1, 30))),
            "schema_version": SCHEMA_VERSION,
            "generated_at": iso(anchor),
        }

    passengers: list[dict[str, Any]] = []
    # passengers materialized from charter orders
    for order in orders:
        if len(passengers) >= n:
            break
        if order.get("order_type") != "charter_passenger":
            continue
        group = order.get("passenger_group") or {}
        # never materialize more passengers than the booked group holds
        k = min(group.get("pax_count", 3), rng.randint(2, 3), n - len(passengers))
        # ride the operation of the first operation-backed planned leg,
        # from that leg through the last consecutive leg of the same operation
        op_id = next((pl.get("operation_id") for pl in order["planned_legs"] if pl.get("operation_id")), None)
        if op_id is not None and op_id in ops_by_id:
            op = ops_by_id[op_id]
            op_legs = op["legs"]
            start_idx = next(
                (idx for idx, lg in enumerate(op_legs, start=1)
                 if any(pl["from_iata"] == lg["from_iata"] and pl["to_iata"] == lg["to_iata"]
                        for pl in order["planned_legs"] if pl.get("operation_id") == op_id)),
                1,
            )
            op_refs = [pl for pl in order["planned_legs"] if pl.get("operation_id") == op_id]
            last_leg = next(
                (lg for lg in reversed(op_legs)
                 if any(pl["from_iata"] == lg["from_iata"] and pl["to_iata"] == lg["to_iata"] for pl in op_refs)),
                op_legs[start_idx - 1],
            )
            j = next(idx for idx, lg in enumerate(op_legs, start=1) if lg is last_leg)
            i, j = start_idx, max(start_idx, j)
        else:
            op = rng.choice(by_op.get(order["operator_id"]) or bookable_pax)
            i, j = _choose_span(rng, op["legs"])
        for _ in range(k):
            passengers.append(make(order["order_id"], op, i, j))

    # standalone fill: round-robin over operators with bookable operations
    pax_ops_with_ops = sorted(by_op)
    oi = 0
    while pax_ops_with_ops and len(passengers) < n:
        op_id = pax_ops_with_ops[oi % len(pax_ops_with_ops)]
        oi += 1
        op = rng.choice(by_op[op_id])
        i, j = _choose_span(rng, op["legs"])
        passengers.append(make(None, op, i, j))
    return passengers


def _ground_crew_by_op(staff: list[dict[str, Any]]) -> dict[str, list[str]]:
    """Map operator_id -> list of ground_crew staff_ids."""
    by_op: dict[str, list[str]] = {}
    for s in staff:
        if s["role_class"] == "ground_crew":
            by_op.setdefault(s["operator_id"], []).append(s["staff_id"])
    return by_op


def _flight_crew_by_op(staff: list[dict[str, Any]]) -> dict[str, list[str]]:
    """Map operator_id -> list of flight_crew staff_ids."""
    by_op: dict[str, list[str]] = {}
    for s in staff:
        if s["role_class"] == "flight_crew":
            by_op.setdefault(s["operator_id"], []).append(s["staff_id"])
    return by_op


def _warehouses_by_airport(facilities: list[dict[str, Any]]) -> dict[str, list[str]]:
    """Map airport_iata -> list of warehouse facility_ids."""
    by_airport: dict[str, list[str]] = {}
    for f in facilities:
        if f["facility_type"] == "warehouse":
            by_airport.setdefault(f["airport_iata"], []).append(f["facility_id"])
    return by_airport


def generate_transit_events(
    rng: random.Random, ids: IdAssigner,
    cargo: list[dict[str, Any]], passengers: list[dict[str, Any]],
    operations: list[dict[str, Any]], facilities: list[dict[str, Any]],
    staff: list[dict[str, Any]], anchor: dt.date,
) -> list[dict[str, Any]]:
    """Unified state-transition events for cargo and passengers.

    One ``transit_event`` chain per subject, built from the booked
    operation's leg timetable: cargo emits per-leg depart/arrive (with
    optional warehouse holds at intermediate stops), passengers ride
    through from board leg to alight leg. Only events at or before the
    anchor instant are emitted; the subject's oracle ``status`` in
    cargo.jsonl/passengers.jsonl is the last state reached (``scheduled``
    / ``booked`` when nothing has happened yet). Each event records a
    named verb and its transition; every transition must exist in the
    DB's ``transit_transition`` lookup or the load fails. Chain
    continuity is asserted here.
    """
    now = anchor_instant(anchor)
    ops_by_id = {o["operation_id"]: o for o in operations}
    warehouses_by_airport = _warehouses_by_airport(facilities)
    ground_crew_by_op = _ground_crew_by_op(staff)
    flight_crew_by_op = _flight_crew_by_op(staff)

    def ground_actor(op_id: str) -> str | None:
        crew = ground_crew_by_op.get(op_id)
        return rng.choice(crew) if crew else None

    def flight_actor(op_id: str) -> str | None:
        crew = flight_crew_by_op.get(op_id)
        return rng.choice(crew) if crew else None

    events: list[dict[str, Any]] = []

    def flush(subject_type: str, subject_id: str, rec: dict[str, Any],
              planned: list[dict[str, Any]], initial_state: str) -> None:
        """Emit the planned chain truncated at the anchor instant."""
        current = initial_state
        seq = 0
        for e in planned:
            if e["at"] > now:
                break
            if e["from_state"] != current:
                raise AssertionError(
                    f"chain continuity violation for {subject_type} {subject_id}: "
                    f"emit {e['from_state']}->{e['to_state']} but current state is "
                    f"{current}"
                )
            seq += 1
            events.append({
                "event_id": ids.next("tev"),
                "subject_type": subject_type,
                "cargo_id": subject_id if subject_type == "cargo" else None,
                "passenger_id": subject_id if subject_type == "passenger" else None,
                "sequence": seq,
                "event_type": e["event_type"],
                "from_state": e["from_state"],
                "to_state": e["to_state"],
                "location_iata": e["location"],
                "vehicle_id": e["vehicle_id"],
                "facility_id": e["facility_id"],
                "actor_id": e["actor_id"],
                "valid_time": e["at"].isoformat(),
                "schema_version": SCHEMA_VERSION,
                "generated_at": iso(anchor),
            })
            current = e["to_state"]
        rec["status"] = current

    # -------------------------------------------------------------- cargo --
    for rec in cargo:
        op = ops_by_id[rec["operation_id"]]
        legs = op["legs"]
        i, j = rec["board_leg_sequence"], rec["alight_leg_sequence"]
        veh = op["vehicle_id"]
        g = ground_actor(op["operator_id"])
        dep_k = [dt.datetime.fromisoformat(lg["scheduled_departure"]) for lg in legs]
        arr_k = [dt.datetime.fromisoformat(lg["scheduled_arrival"]) for lg in legs]

        def plan(event_type, from_state, to_state, location, at, *,
                 vehicle_id=None, facility_id=None, actor_id=None):
            return {"event_type": event_type, "from_state": from_state, "to_state": to_state,
                    "location": location, "at": at, "vehicle_id": vehicle_id,
                    "facility_id": facility_id, "actor_id": actor_id}

        planned = [
            plan("pickup", "scheduled", "picked_up", legs[i - 1]["from_iata"],
                 dep_k[i - 1] - dt.timedelta(hours=rng.randint(4, 24)), actor_id=g),
            plan("load", "picked_up", "loaded", legs[i - 1]["from_iata"],
                 dep_k[i - 1] - dt.timedelta(hours=rng.randint(1, 3)),
                 vehicle_id=veh, actor_id=g),
        ]
        for k in range(i, j + 1):
            planned.append(plan("depart", "loaded", "in_transit", legs[k - 1]["from_iata"],
                                dep_k[k - 1], vehicle_id=veh, actor_id=g))
            planned.append(plan("arrive", "in_transit", "arrived", legs[k - 1]["to_iata"],
                                arr_k[k - 1], vehicle_id=veh, actor_id=g))
            if k < j:
                holds = warehouses_by_airport.get(legs[k - 1]["to_iata"])
                if holds and rng.random() < 0.3:
                    planned.append(plan("hold", "arrived", "held", legs[k - 1]["to_iata"],
                                         arr_k[k - 1] + dt.timedelta(minutes=15),
                                         facility_id=rng.choice(holds), actor_id=g))
                    planned.append(plan("load", "held", "loaded", legs[k - 1]["to_iata"],
                                         dep_k[k] - dt.timedelta(minutes=15),
                                         vehicle_id=veh, actor_id=g))
                else:
                    planned.append(plan("load", "arrived", "loaded", legs[k - 1]["to_iata"],
                                         dep_k[k] - dt.timedelta(minutes=15),
                                         vehicle_id=veh, actor_id=g))
        planned.append(plan("deliver", "arrived", "delivered", legs[j - 1]["to_iata"],
                            arr_k[j - 1] + dt.timedelta(hours=rng.randint(2, 12)),
                            vehicle_id=veh, actor_id=g))
        flush("cargo", rec["cargo_id"], rec, planned, "scheduled")

    # --------------------------------------------------------- passenger --
    for pax in passengers:
        op = ops_by_id[pax["operation_id"]]
        legs = op["legs"]
        i, j = pax["board_leg_sequence"], pax["alight_leg_sequence"]
        veh = op["vehicle_id"]
        g = ground_actor(op["operator_id"])
        f = flight_actor(op["operator_id"])
        dep_i = dt.datetime.fromisoformat(legs[i - 1]["scheduled_departure"])
        arr_j = dt.datetime.fromisoformat(legs[j - 1]["scheduled_arrival"])

        def plan(event_type, from_state, to_state, location, at, *,
                 vehicle_id=None, facility_id=None, actor_id=None):
            return {"event_type": event_type, "from_state": from_state, "to_state": to_state,
                    "location": location, "at": at, "vehicle_id": vehicle_id,
                    "facility_id": facility_id, "actor_id": actor_id}

        planned = [
            plan("check_in", "booked", "checked_in", legs[i - 1]["from_iata"],
                 dep_i - dt.timedelta(hours=rng.randint(2, 4)), actor_id=g),
            plan("board", "checked_in", "boarded", legs[i - 1]["from_iata"],
                 dep_i - dt.timedelta(minutes=rng.randint(30, 60)),
                 vehicle_id=veh, actor_id=f),
            plan("depart", "boarded", "in_transit", legs[i - 1]["from_iata"],
                 dep_i, vehicle_id=veh, actor_id=f),
            plan("arrive", "in_transit", "arrived", legs[j - 1]["to_iata"],
                 arr_j, vehicle_id=veh, actor_id=f),
            plan("disembark", "arrived", "disembarked", legs[j - 1]["to_iata"],
                 arr_j + dt.timedelta(minutes=rng.randint(15, 45)), actor_id=f),
        ]
        flush("passenger", pax["passenger_id"], pax, planned, "booked")

    return events