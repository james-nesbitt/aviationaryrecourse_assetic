/** Display formatting for dates, durations and leg chains. */

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const iso = value.includes("T") ? value : `${value}T00:00:00`;
  return iso.slice(0, 16).replace("T", " ");
}

export function formatHours(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toFixed(1)}h`;
}

/** "LAX → DEN → LAX" from a leg list. */
export function legChain(legs: { from_iata: string; to_iata: string }[]): string {
  if (legs.length === 0) return "—";
  return [legs[0].from_iata, ...legs.map((l) => l.to_iata)].join(" → ");
}

/** Block time of a trip in hours, first departure to last arrival. */
export function tripHours(legs: { scheduled_departure: string; scheduled_arrival: string }[]): number {
  if (legs.length === 0) return 0;
  const dep = new Date(legs[0].scheduled_departure).getTime();
  const arr = new Date(legs[legs.length - 1].scheduled_arrival).getTime();
  return (arr - dep) / 3_600_000;
}

export const STATUS_COLORS: Record<string, string> = {
  completed: "#2e7d32",
  in_progress: "#1565c0",
  scheduled: "#6a6a6a",
  cancelled: "#c62828",
  ok: "#2e7d32",
  warn: "#ef6c00",
  critical: "#c62828",
  active: "#2e7d32",
  maintenance: "#ef6c00",
  stored: "#6a6a6a",
};
