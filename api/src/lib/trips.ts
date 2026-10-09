/**
 * Server-side trip generation for route writes.
 *
 * Mirrors assetic_datagen.generators.entities.generate_trips: a trip's legs
 * are the route legs shifted by (operating_date - first_operating_date), and
 * its status follows from the anchor instant. Routes created or changed
 * through the API use the server date at noon as the anchor, so an
 * API-created trip's status obeys the same rule as a generated one.
 */

export interface RouteLeg {
  sequence: number;
  from_iata: string;
  to_iata: string;
  scheduled_departure: string;
  scheduled_arrival: string;
}

export type TripStatus = "scheduled" | "in_progress" | "completed" | "cancelled";

const DAY_MS = 86_400_000;

/** Legs of `route` shifted onto `operatingDate`. */
export function shiftLegs(
  legs: RouteLeg[],
  firstOperatingDate: Date,
  operatingDate: Date,
): RouteLeg[] {
  const delta = operatingDate.getTime() - firstOperatingDate.getTime();
  return legs.map((leg) => ({
    ...leg,
    scheduled_departure: new Date(new Date(leg.scheduled_departure).getTime() + delta).toISOString(),
    scheduled_arrival: new Date(new Date(leg.scheduled_arrival).getTime() + delta).toISOString(),
  }));
}

/** completed / in_progress / scheduled by where `anchorAt` falls in the legs. */
export function tripStatus(legs: RouteLeg[], anchorAt: Date): TripStatus {
  const firstDep = new Date(legs[0].scheduled_departure).getTime();
  const lastArr = new Date(legs[legs.length - 1].scheduled_arrival).getTime();
  const now = anchorAt.getTime();
  if (lastArr < now) return "completed";
  if (firstDep <= now) return "in_progress";
  return "scheduled";
}

/** Operating dates of a route from `from` through `through`, inclusive. */
export function operatingDates(
  firstOperatingDate: Date,
  frequencyDays: number,
  from: Date,
  through: Date,
): Date[] {
  const dates: Date[] = [];
  const first = firstOperatingDate.getTime();
  const step = frequencyDays * DAY_MS;
  let k = Math.max(0, Math.ceil((from.getTime() - first) / step));
  for (let t = first + k * step; t <= through.getTime(); t += step) {
    dates.push(new Date(t));
  }
  return dates;
}
