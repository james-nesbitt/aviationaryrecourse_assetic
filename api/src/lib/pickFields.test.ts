import { describe, expect, it } from "vitest";
import { missingFields, pickFields } from "./pickFields.js";

describe("pickFields", () => {
  const body = {
    name: "Tundra Air",
    country: "US",
    schema_version: 99, // provenance: must never pass through
    generated_at: "2030-01-01", // provenance: must never pass through
    operator_id: "opr-9999",
  };

  it("keeps only allowed fields and drops everything else", () => {
    const picked = pickFields(body, ["name", "country"]);
    expect(picked).toEqual({ name: "Tundra Air", country: "US" });
  });

  it("maps snake_case body keys to camelCase Prisma keys", () => {
    const picked = pickFields(body, ["operator_id"]);
    expect(picked).toEqual({ operatorId: "opr-9999" });
  });

  it("omits absent fields rather than writing undefined", () => {
    const picked = pickFields(body, ["name", "fleet_size_hint"]);
    expect(picked).toEqual({ name: "Tundra Air" });
    expect("fleetSizeHint" in picked).toBe(false);
  });

  it("drops a key that is absent from the map only if not allowed verbatim", () => {
    // status maps to itself; unknown-to-map allowed keys pass through
    const picked = pickFields({ status: "requested" }, ["status"]);
    expect(picked).toEqual({ status: "requested" });
  });
});

describe("missingFields", () => {
  it("lists required fields the body omits", () => {
    expect(missingFields({ name: "x" }, ["name", "type", "country"])).toEqual([
      "type",
      "country",
    ]);
  });

  it("is empty when everything required is present", () => {
    expect(missingFields({ name: "x", type: "passenger" }, ["name", "type"])).toEqual([]);
  });
});