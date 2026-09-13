"""Deterministic date window and seeded RNG helpers.

All randomness in assetic-datagen flows through a single ``random.Random``
seeded from ``--seed``. The generation window is anchored to a fixed epoch
derived from the seed so that reruns on different days produce byte-identical
output unless ``--as-of`` is passed.
"""

from __future__ import annotations

import datetime as dt
import random


def anchor_date(seed: int, as_of: str | None) -> dt.date:
    """Return the anchor date for the generation window.

    ``as_of`` (``YYYY-MM-DD``) wins when given; otherwise the seed is hashed
    onto the epoch (2000-01-01) so the same seed always lands on the same
    anchor regardless of the real wall clock.
    """
    if as_of is not None:
        return dt.date.fromisoformat(as_of)
    epoch = dt.date(2000, 1, 1)
    return epoch + dt.timedelta(days=seed % 8000)


def window_start(anchor: dt.date, window_days: int) -> dt.date:
    return anchor - dt.timedelta(days=window_days)


def random_date_in_window(rng: random.Random, start: dt.date, end: dt.date) -> dt.date:
    """Uniform date in [start, end]; end exclusive keeps ranges tidy."""
    span = (end - start).days
    if span <= 0:
        return start
    return start + dt.timedelta(days=rng.randrange(span))


def iso(d: dt.date) -> str:
    return d.isoformat()