/**
 * Crew fatigue thresholds and level computation.
 *
 * Keep in sync with the CASE expression in db/migrations/006_trips_crew.sql
 * (view crew_fatigue_v). The view serves read paths; this module serves the
 * write path, where a candidate assignment's hypothetical duty hours must be
 * evaluated before the row exists.
 *
 * Decided 2026-10-09 (spec docs/spec/ui-role-interfaces.md section 9.4):
 * deliberately above regulatory lines so the synthetic dataset shows a mix of
 * levels rather than an all-critical roster.
 */

export const FATIGUE_THRESHOLDS = {
  warn: { dutyHours7d: 40, consecutiveDutyDays: 5, restHours: 12 },
  critical: { dutyHours7d: 55, consecutiveDutyDays: 6, restHours: 10 },
} as const;

export type FatigueLevel = "ok" | "warn" | "critical";

export interface FatigueMetrics {
  dutyHours7d: number;
  consecutiveDutyDays: number;
  /** null when the staff member has no completed trip yet */
  restSinceLastHours: number | null;
}

/** Highest triggered level across the three metrics. */
export function fatigueLevel(m: FatigueMetrics): FatigueLevel {
  const { warn, critical } = FATIGUE_THRESHOLDS;
  if (
    m.dutyHours7d > critical.dutyHours7d ||
    m.consecutiveDutyDays > critical.consecutiveDutyDays ||
    (m.restSinceLastHours !== null && m.restSinceLastHours < critical.restHours)
  ) {
    return "critical";
  }
  if (
    m.dutyHours7d > warn.dutyHours7d ||
    m.consecutiveDutyDays > warn.consecutiveDutyDays ||
    (m.restSinceLastHours !== null && m.restSinceLastHours < warn.restHours)
  ) {
    return "warn";
  }
  return "ok";
}

interface TripLeg {
  scheduled_departure: string;
  scheduled_arrival: string;
}

/** Duty hours a trip contributes: block time plus 2h pre/post duty. */
export function tripDutyHours(legs: TripLeg[]): number {
  if (legs.length === 0) return 0;
  const dep = new Date(legs[0].scheduled_departure).getTime();
  const arr = new Date(legs[legs.length - 1].scheduled_arrival).getTime();
  return (arr - dep) / 3_600_000 + 2;
}
