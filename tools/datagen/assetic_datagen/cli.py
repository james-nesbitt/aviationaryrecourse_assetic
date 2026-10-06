"""assetic-datagen command-line interface."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import random
import sys
from pathlib import Path

from . import reference
from .generators import (
    generate_cargo,
    generate_carrier_customers,
    generate_facilities,
    generate_operators,
    generate_orders,
    generate_ownership_history,
    generate_passengers,
    generate_route_assignments,
    generate_route_operations,
    generate_routes,
    generate_staff,
    generate_transit_events,
    generate_vehicle_maintenance,
    generate_vehicles,
)
from .ids import IdAssigner
from .rng import anchor_date

SCALE_FACTORS = {"small": 0.5, "medium": 1.0, "large": 3.0}

DEFAULTS = {
    "operators": 8,
    "vehicles": 30,
    "staff": 60,
    "facilities": 12,
    "customers": 10,
    "routes": 25,
    "orders": 30,
}

# subjects per day (at medium scale) for rate-driven entities
RATES = {"cargo": 0.25, "passengers": 0.5}


def _scale_count(args: argparse.Namespace, key: str) -> int:
    """Explicit --num-X wins; otherwise scale factor applies to the default."""
    explicit = getattr(args, f"num_{key}")
    if explicit is not None:
        return explicit
    return max(1, round(DEFAULTS[key] * SCALE_FACTORS[args.scale]))


def _rate_count(args: argparse.Namespace, key: str) -> int:
    """Explicit --num-X wins; otherwise subjects/day scaled by the window."""
    explicit = getattr(args, f"num_{key}")
    if explicit is not None:
        return explicit
    rate = getattr(args, f"{key}_per_day") or RATES[key]
    return max(1, round(rate * args.window_days * SCALE_FACTORS[args.scale]))


def _write_jsonl(path: Path, records: list[dict]) -> int:
    with path.open("w", encoding="utf-8", newline="\n") as fh:
        for rec in records:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return len(records)


def cmd_generate(args: argparse.Namespace) -> int:
    rng = random.Random(args.seed)
    ids = IdAssigner()
    anchor = anchor_date(args.seed, args.as_of)
    cache_dir = Path(args.cache_dir) if args.cache_dir else None
    airports, origin = reference.resolve_airports(args.airports_source, cache_dir)
    models = reference.load_aircraft_models()
    pools = reference.load_name_pools()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    counts: dict = {"operators": _scale_count(args, "operators"),
                    "vehicles": _scale_count(args, "vehicles"),
                    "staff": _scale_count(args, "staff"),
                    "facilities": _scale_count(args, "facilities"),
                    "customers": _scale_count(args, "customers"),
                    "routes": _scale_count(args, "routes"),
                    "orders": _scale_count(args, "orders"),
                    "cargo": _rate_count(args, "cargo"),
                    "passengers": _rate_count(args, "passengers")}
    operators = generate_operators(rng, ids, pools, airports, counts["operators"], anchor, args.window_days)
    vehicles = generate_vehicles(rng, ids, pools, operators, models, airports, counts["vehicles"], anchor)
    ownership = generate_ownership_history(rng, vehicles, operators, anchor, args.window_days)
    staff = generate_staff(rng, ids, pools, operators, airports, counts["staff"], anchor, args.window_days)
    facilities = generate_facilities(rng, ids, operators, airports, counts["facilities"], anchor)
    account_managers = [s for s in staff if s["role"] == "account_manager"]
    customers = generate_carrier_customers(rng, ids, pools, operators, account_managers, counts["customers"], anchor, args.window_days)
    routes = generate_routes(rng, ids, vehicles, operators, airports, models, counts["routes"], anchor, args.window_days)
    maintenance = generate_vehicle_maintenance(rng, ids, vehicles, facilities, anchor, args.window_days)
    assignments = generate_route_assignments(rng, ids, routes, vehicles, maintenance, anchor)
    operations = generate_route_operations(ids, routes, assignments, maintenance, anchor)
    cargo = generate_cargo(rng, ids, operations, routes, operators, customers, counts["cargo"], anchor)
    orders = generate_orders(rng, ids, pools, customers, operations, staff, None, airports, models, counts["orders"], anchor, args.window_days)
    passengers = generate_passengers(rng, ids, pools, orders, operations, routes, operators, counts["passengers"], anchor)
    transit_events = generate_transit_events(rng, ids, cargo, passengers, operations, facilities, staff, anchor)

    files = [
        ("operators.jsonl", operators),
        ("vehicles.jsonl", vehicles),
        ("ownership_history.jsonl", ownership),
        ("staff.jsonl", staff),
        ("facilities.jsonl", facilities),
        ("carrier_customers.jsonl", customers),
        ("routes.jsonl", routes),
        ("vehicle_maintenance.jsonl", maintenance),
        ("route_assignments.jsonl", assignments),
        ("route_operations.jsonl", operations),
        ("cargo.jsonl", cargo),
        ("orders.jsonl", orders),
        ("passengers.jsonl", passengers),
        ("transit_events.jsonl", transit_events),
        ("airports.jsonl", airports),
        ("aircraft_models.jsonl", models),
    ]

    print(f"seed: {args.seed}  anchor: {anchor.isoformat()}  airports: {origin}")
    total = 0
    for filename, records in files:
        written = _write_jsonl(out_dir / filename, records)
        total += written
        print(f"  {filename:<26} {written:>6} records")
    print(f"wrote {total} records to {out_dir}")
    return 0


def cmd_refresh_airports(args: argparse.Namespace) -> int:
    cache_dir = Path(args.cache_dir) if args.cache_dir else None
    try:
        if args.source == "ourairports":
            records = reference.fetch_ourairports()
        else:
            records = reference.fetch_openflights()
    except (reference.FetchError, OSError) as exc:
        print(f"error: failed to fetch {args.source} airports: {exc}", file=sys.stderr)
        return 1
    path = reference.write_airports_cache(records, cache_dir)
    print(f"wrote {len(records)} airports to {path}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="assetic-datagen",
        description="Generate synthetic assetic testing data as JSONL files.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    gen = sub.add_parser("generate", help="generate JSONL entity files")
    gen.add_argument("--seed", type=int, default=42, help="RNG seed (default 42)")
    gen.add_argument("--out", default="datagen-out", help="output directory (default ./datagen-out)")
    gen.add_argument("--as-of", default=None, help="anchor date YYYY-MM-DD (default: seed-derived)")
    gen.add_argument("--window-days", type=int, default=365, help="generation lookback window in days (default 365)")
    gen.add_argument("--scale", choices=sorted(SCALE_FACTORS), default="medium",
                     help="preset size (small=0.5x, medium=1x, large=3x of defaults)")
    gen.add_argument("--airports-source", choices=["embedded", "cache"], default="cache",
                     help="embedded curated set, or cache with embedded fallback (default cache)")
    gen.add_argument("--cache-dir", default=None, help="reference-data cache dir (default $XDG_CACHE_HOME/assetic-datagen)")
    for key in DEFAULTS:
        gen.add_argument(f"--num-{key.replace('_', '-')}", type=int, default=None,
                         help=f"exact count (overrides --scale) for {key} (default {DEFAULTS[key]})")
    for key, rate in RATES.items():
        gen.add_argument(f"--num-{key.replace('_', '-')}", type=int, default=None,
                         help=f"exact count (overrides rate) for {key}")
        gen.add_argument(f"--{key.replace('_', '-')}-per-day", type=float, default=None,
                         help=f"subjects per day (default {rate}) for {key}, scaled by --window-days")
    gen.set_defaults(func=cmd_generate)

    refresh = sub.add_parser("refresh-airports", help="download NA/EU airports into the cache")
    refresh.add_argument("--source", choices=["ourairports", "openflights"], default="ourairports")
    refresh.add_argument("--cache-dir", default=None, help="cache dir (default $XDG_CACHE_HOME/assetic-datagen)")
    refresh.set_defaults(func=cmd_refresh_airports)

    return parser

def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except BrokenPipeError:
        # stdout closed early (e.g. piped to head); exit quietly per POSIX convention
        try:
            sys.stdout.close()
        except OSError:
            pass
        return 0

if __name__ == "__main__":
    sys.exit(main())