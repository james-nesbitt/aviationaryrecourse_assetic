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
    passenger_ops = [op for op in operators if op["type"] in ("passenger", "military")]

    staff: list[dict[str, Any]] = []
    for _ in range(n):
        role_class = rng.choices(["flight_crew", "ground_crew"], weights=[45, 55])[0]
        if role_class == "flight_crew" and not passenger_ops:
            role_class = "ground_crew"
        if role_class == "flight_crew":
            op = rng.choice(passenger_ops)
            role = rng.choice(flight_roles)
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
    operators: list[dict[str, Any]], n: int, anchor: dt.date, window_days: int,
) -> list[dict[str, Any]]:
    cargo_ops = [op for op in operators if op["type"] == "cargo"]
    if not cargo_ops:
        cargo_ops = operators  # degenerate small fleets: any operator contracts
    customers: list[dict[str, Any]] = []
    for _ in range(n):
        customers.append({
            "customer_id": ids.next("cus"),
            "company_name": f"{rng.choice(pools['customer_company_roots'])} {rng.choice(pools['customer_company_suffixes'])}",
            "operator_id": rng.choice(cargo_ops)["operator_id"],
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