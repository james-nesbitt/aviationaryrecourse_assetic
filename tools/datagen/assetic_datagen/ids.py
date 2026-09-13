"""Deterministic prefixed IDs for every generated entity."""

from __future__ import annotations


class IdAssigner:
    """Hands out zero-padded, prefixed sequential IDs (``opr-0001`` etc.)."""

    def __init__(self) -> None:
        self._counters: dict[str, int] = {}

    def next(self, prefix: str) -> str:
        self._counters[prefix] = self._counters.get(prefix, 0) + 1
        return f"{prefix}-{self._counters[prefix]:04d}"

    def count(self, prefix: str) -> int:
        return self._counters.get(prefix, 0)