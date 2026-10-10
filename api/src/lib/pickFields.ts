/**
 * Mass-assignment guard for write endpoints: keep only the named body
 * fields, mapped to their Prisma (camelCase) names. A PATCH/POST can then
 * only set what the endpoint's contract names — never schema_version,
 * generated_at, or foreign keys outside the contract.
 *
 * Bodies arrive in snake_case (the API's wire format); Prisma inputs are
 * camelCase, so each allowed field carries its mapping. Fields listed but
 * absent from the body are omitted — Prisma treats absent keys as
 * "unchanged", so a partial PATCH stays partial.
 *
 * Returns a discriminated result so callers reject a create that is
 * missing required fields before it reaches Prisma.
 */
const FIELD_MAP: Record<string, string> = {
  name: "name",
  type: "type",
  country: "country",
  operator_id: "operatorId",
  hub_iata: "hubIata",
  founded_year: "foundedYear",
  fleet_size_hint: "fleetSizeHint",
  order_id: "orderId",
  customer_id: "customerId",
  order_type: "orderType",
  account_manager_id: "accountManagerId",
  trip_manager_id: "tripManagerId",
  origin_iata: "originIata",
  destination_iata: "destinationIata",
  planned_legs: "plannedLegs",
  transit_route_ids: "transitRouteIds",
  ordered_on: "orderedOn",
  status: "status",
  passenger_group: "passengerGroup",
  freight: "freight",
};

export function pickFields(
  body: Record<string, unknown>,
  allowed: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) out[FIELD_MAP[key] ?? key] = body[key];
  }
  return out;
}

/** Missing snake_case keys among `required`, for a 400 message. */
export function missingFields(
  body: Record<string, unknown>,
  required: readonly string[],
): string[] {
  return required.filter((key) => body[key] === undefined);
}