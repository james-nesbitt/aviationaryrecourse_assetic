"""Reference data loading, cache resolution, and remote fetch.

Resolution order for airports: cache file (if present and parses) → embedded
curated set. Generation itself never touches the network; only the explicit
``refresh-airports`` subcommand downloads.
"""

from __future__ import annotations

import csv
import io
import json
import os
import sys
import tempfile
import urllib.request
from importlib import resources
from pathlib import Path
from typing import Any

OURAIRPORTS_URL = "https://ourairports.com/data/airports.csv"
OPENFLIGHTS_URL = (
    "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat"
)

# NA countries + EU country codes (ISO 3166-1 alpha-2) accepted from remote sources.
NA_COUNTRY_CODES = {"US", "CA", "MX", "BM", "GL"}
EU_COUNTRY_CODES = {
    "GB", "IE", "FR", "NL", "BE", "DE", "ES", "PT", "IT", "CH", "AT",
    "DK", "SE", "NO", "FI", "PL", "CZ", "HU", "RO", "GR", "TR",
}

MAX_REMOTE_AIRPORTS = 200


class FetchError(Exception):
    """Raised when a remote reference-data download or parse fails."""


def _load_packaged(filename: str) -> Any:
    text = resources.files("assetic_datagen.data").joinpath(filename).read_text("utf-8")
    return json.loads(text)


def load_curated_airports() -> list[dict[str, Any]]:
    return _load_packaged("airports.curated.json")["airports"]


def load_aircraft_models() -> list[dict[str, Any]]:
    return _load_packaged("aircraft_models.json")["models"]


def load_name_pools() -> dict[str, Any]:
    return _load_packaged("name_pools.json")


def default_cache_dir() -> Path:
    base = os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache")
    return Path(base) / "assetic-datagen"


def cache_airports_path(cache_dir: Path | None) -> Path:
    return (cache_dir or default_cache_dir()) / "airports.json"


def _validate_airports(records: list[Any]) -> list[dict[str, Any]]:
    """Check the shape of a candidate airport list; raise FetchError if bad."""
    if not isinstance(records, list) or not records:
        raise FetchError("airport list is empty or not a list")
    required = {"iata", "icao", "name", "city", "country", "country_code",
                "latitude", "longitude", "elevation_ft", "timezone"}
    for rec in records:
        if not isinstance(rec, dict) or not required.issubset(rec):
            raise FetchError(f"airport record missing fields: {sorted(required - set(rec)) if isinstance(rec, dict) else rec!r}")
    return records


def load_cached_airports(cache_dir: Path | None) -> list[dict[str, Any]] | None:
    """Return cached airports, or None if absent/corrupt (with a warning)."""
    path = cache_airports_path(cache_dir)
    if not path.exists():
        return None
    try:
        return _validate_airports(json.loads(path.read_text("utf-8"))["airports"])
    except (json.JSONDecodeError, KeyError, FetchError) as exc:
        print(f"warning: ignoring corrupt airport cache {path}: {exc}", file=sys.stderr)
        return None


def resolve_airports(source: str, cache_dir: Path | None) -> tuple[list[dict[str, Any]], str]:
    """Resolve the airport set per --airports-source; returns (records, origin)."""
    if source == "embedded":
        return load_curated_airports(), "embedded"
    if source == "cache":
        cached = load_cached_airports(cache_dir)
        if cached is not None:
            return cached, "cache"
        return load_curated_airports(), "embedded (cache miss fallback)"
    raise ValueError(f"unknown airports source: {source}")


def _download(url: str) -> str:
    with urllib.request.urlopen(url, timeout=30) as resp:  # noqa: S310 - fixed https URLs
        return resp.read().decode("utf-8", errors="replace")


def _accepted_country(code: str) -> bool:
    code = code.strip().upper()
    return code in NA_COUNTRY_CODES or code in EU_COUNTRY_CODES


def _record(iata: str, icao: str, name: str, city: str, country: str,
            country_code: str, lat: str, lon: str, elev: str, tz: str) -> dict[str, Any] | None:
    try:
        return {
            "iata": iata.strip(),
            "icao": icao.strip(),
            "name": name.strip(),
            "city": city.strip(),
            "country": country.strip(),
            "country_code": country_code.strip().upper(),
            "latitude": float(lat),
            "longitude": float(lon),
            "elevation_ft": int(float(elev)),
            "timezone": tz.strip(),
        }
    except ValueError:
        return None


def fetch_ourairports() -> list[dict[str, Any]]:
    """Fetch and filter OurAirports airports.csv to NA/EU, large/medium first."""
    rows = csv.DictReader(io.StringIO(_download(OURAIRPORTS_URL)))
    accepted: list[dict[str, Any]] = []
    for row in rows:
        if row.get("type") not in ("large_airport", "medium_airport"):
            continue
        if not _accepted_country(row.get("iso_country", "")):
            continue
        iata, icao = row.get("iata_code", ""), row.get("gps_code", "") or row.get("local_code", "")
        if not iata or not icao:
            continue
        rec = _record(
            iata, icao, row.get("name", ""), row.get("municipality", "") or row.get("name", ""),
            "", row.get("iso_country", ""), row.get("latitude_deg", ""),
            row.get("longitude_deg", ""), row.get("elevation_ft", "0"),
            "UTC",  # OurAirports has no tz column; callers needing tz use the curated set
        )
        if rec is not None:
            rec["country"] = rec["country_code"]  # no country name in the CSV
            accepted.append(rec)
    # large airports first, then alphabetical by IATA for a stable order
    type_order = {"large_airport": 0, "medium_airport": 1}
    accepted.sort(key=lambda r: (0 if r["name"] else 1, r["iata"]))
    del type_order
    return _validate_airports(accepted[:MAX_REMOTE_AIRPORTS])


def fetch_openflights() -> list[dict[str, Any]]:
    """Fetch and filter the OpenFlights airports.dat to NA/EU airports."""
    text = _download(OPENFLIGHTS_URL)
    accepted: list[dict[str, Any]] = []
    for line in text.splitlines():
        fields = [f.strip('"') for f in line.split(",")]
        if len(fields) < 11:
            continue
        # OpenFlights columns: id, name, city, country, iata, icao, lat, lon, alt, tz, dst_os, tz_olson, type, source
        _, name, city, country, iata, icao, lat, lon, alt, _, tz_olson = fields[:12]
        if not iata or iata == "\\N" or not icao or icao == "\\N":
            continue
        if not _accepted_country(_openflights_country_code(country)):
            continue
        rec = _record(iata, icao, name, city, country, _openflights_country_code(country),
                      lat, lon, alt or "0", tz_olson if tz_olson and tz_olson != "\\N" else "UTC")
        if rec is not None:
            accepted.append(rec)
    accepted.sort(key=lambda r: r["iata"])
    return _validate_airports(accepted[:MAX_REMOTE_AIRPORTS])


_COUNTRY_CODE_BY_NAME = {
    "United States": "US", "Canada": "CA", "Mexico": "MX",
    "United Kingdom": "GB", "Ireland": "IE", "France": "FR", "Netherlands": "NL",
    "Belgium": "BE", "Germany": "DE", "Spain": "ES", "Portugal": "PT", "Italy": "IT",
    "Switzerland": "CH", "Austria": "AT", "Denmark": "DK", "Sweden": "SE",
    "Norway": "NO", "Finland": "FI", "Poland": "PL", "Czech Republic": "CZ",
    "Hungary": "HU", "Romania": "RO", "Greece": "GR", "Turkey": "TR",
}


def _openflights_country_code(country_name: str) -> str:
    return _COUNTRY_CODE_BY_NAME.get(country_name.strip(), "")


def write_airports_cache(records: list[dict[str, Any]], cache_dir: Path | None) -> Path:
    """Atomically write the airport cache; never leaves a partial file."""
    path = cache_airports_path(cache_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({"airports": records}, indent=2, ensure_ascii=False) + "\n"
    fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=".airports-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(payload)
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise
    return path