import { describe, expect, it } from "vitest";
import { completedYears } from "./age.js";

/** UTC dates, matching how Prisma hands back `@db.Date` columns. */
function d(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

describe("completedYears", () => {
  it("counts a year only once the anniversary is reached", () => {
    expect(completedYears(d("1980-06-15"), d("2000-06-14"))).toBe(19);
    expect(completedYears(d("1980-06-15"), d("2000-06-15"))).toBe(20);
    expect(completedYears(d("1980-06-15"), d("2000-06-16"))).toBe(20);
  });

  it("does not credit a birthday later in the same month", () => {
    expect(completedYears(d("1980-12-31"), d("2000-12-01"))).toBe(19);
  });

  it("does not credit a birthday later in the year", () => {
    expect(completedYears(d("1980-11-02"), d("2000-03-09"))).toBe(19);
  });

  it("handles a 29 February birth date in a non-leap year", () => {
    expect(completedYears(d("1980-02-29"), d("2001-02-28"))).toBe(20);
    expect(completedYears(d("1980-02-29"), d("2001-03-01"))).toBe(21);
  });

  it("returns zero within the first year of life", () => {
    expect(completedYears(d("2000-01-10"), d("2000-09-30"))).toBe(0);
  });
});