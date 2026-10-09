import { describe, it, expect } from "vitest";
import { fatigueLevel, tripDutyHours, FATIGUE_THRESHOLDS } from "./fatigue.js";

describe("fatigueLevel", () => {
  const ok = { dutyHours7d: 10, consecutiveDutyDays: 2, restSinceLastHours: 48 };

  it("returns ok below every threshold", () => {
    expect(fatigueLevel(ok)).toBe("ok");
  });

  it("treats each threshold as exclusive at the boundary", () => {
    expect(fatigueLevel({ ...ok, dutyHours7d: FATIGUE_THRESHOLDS.warn.dutyHours7d })).toBe("ok");
    expect(fatigueLevel({ ...ok, dutyHours7d: FATIGUE_THRESHOLDS.warn.dutyHours7d + 0.1 })).toBe("warn");
    expect(fatigueLevel({ ...ok, dutyHours7d: FATIGUE_THRESHOLDS.critical.dutyHours7d })).toBe("warn");
    expect(fatigueLevel({ ...ok, dutyHours7d: FATIGUE_THRESHOLDS.critical.dutyHours7d + 0.1 })).toBe("critical");
  });

  it("escalates on consecutive duty days alone", () => {
    expect(fatigueLevel({ ...ok, consecutiveDutyDays: 6 })).toBe("warn");
    expect(fatigueLevel({ ...ok, consecutiveDutyDays: 7 })).toBe("critical");
  });

  it("escalates on short rest alone", () => {
    expect(fatigueLevel({ ...ok, restSinceLastHours: 11.9 })).toBe("warn");
    expect(fatigueLevel({ ...ok, restSinceLastHours: 9.9 })).toBe("critical");
  });

  it("ignores rest when the crew member has never flown", () => {
    expect(fatigueLevel({ ...ok, restSinceLastHours: null })).toBe("ok");
  });

  it("takes the highest level across metrics", () => {
    expect(fatigueLevel({ dutyHours7d: 45, consecutiveDutyDays: 7, restSinceLastHours: 48 })).toBe("critical");
  });
});

describe("tripDutyHours", () => {
  it("counts block time plus two hours of pre/post duty", () => {
    const legs = [
      { scheduled_departure: "2000-01-01T06:00:00", scheduled_arrival: "2000-01-01T08:00:00" },
      { scheduled_departure: "2000-01-01T09:00:00", scheduled_arrival: "2000-01-01T12:00:00" },
    ];
    expect(tripDutyHours(legs)).toBe(8);
  });

  it("returns zero for a trip with no legs", () => {
    expect(tripDutyHours([])).toBe(0);
  });
});
