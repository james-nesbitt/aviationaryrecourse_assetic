/**
 * Load JSONL files from tools/datagen output into the assetic Postgres database.
 * Usage: tsx src/scripts/load-jsonl.ts [--dir /path/to/datagen-out]
 *
 * Reads the 11 JSONL files produced by assetic-datagen and inserts them
 * in dependency order: airports, aircraft_models, operators, vehicles,
 * ownership_history, staff, facilities, carrier_customers, cargo, routes, orders.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../lib/prisma.js";

interface JsonlRecord {
  [key: string]: unknown;
}

async function readJsonl(path: string): Promise<JsonlRecord[]> {
  const content = await readFile(path, "utf-8");
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JsonlRecord);
}

function toDate(val: unknown): Date {
  // datagen outputs ISO date strings (YYYY-MM-DD) or datetime strings
  return new Date(val as string);
}

async function loadAll(dir: string): Promise<void> {
  console.log(`Loading JSONL from ${dir}`);

  // ── Airports (reference) ───────────────────────────────────────────────
  const airports = await readJsonl(join(dir, "airports.jsonl"));
  console.log(`  airports: ${airports.length}`);
  await prisma.airport.createMany({
    data: airports.map((r) => ({
      iata: r.iata as string,
      icao: r.icao as string,
      name: r.name as string,
      city: r.city as string,
      country: r.country as string,
      countryCode: r.country_code as string,
      latitude: r.latitude as number,
      longitude: r.longitude as number,
      elevationFt: r.elevation_ft as number,
      timezone: r.timezone as string,
    })),
  });

  // ── Aircraft models (reference) ────────────────────────────────────────
  const models = await readJsonl(join(dir, "aircraft_models.jsonl"));
  console.log(`  aircraft_models: ${models.length}`);
  await prisma.aircraftModel.createMany({
    data: models.map((r) => ({
      modelId: r.model_id as string,
      manufacturer: r.manufacturer as string,
      family: r.family as string,
      icaoType: r.icao_type as string,
      name: r.name as string,
      paxCapacityTypical: r.pax_capacity_typical as number,
      cargoCapacityKg: r.cargo_capacity_kg as number,
      rangeKm: r.range_km as number,
      engineCount: r.engine_count as number,
      category: r.category as string,
    })),
  });

  // ── Operators ──────────────────────────────────────────────────────────
  const operators = await readJsonl(join(dir, "operators.jsonl"));
  console.log(`  operators: ${operators.length}`);
  await prisma.operator.createMany({
    data: operators.map((r) => ({
      operatorId: r.operator_id as string,
      name: r.name as string,
      type: r.type as string,
      country: r.country as string,
      hubIata: r.hub_iata as string,
      foundedYear: r.founded_year as number,
      fleetSizeHint: r.fleet_size_hint as number,
      schemaVersion: r.schema_version as number,
      generatedAt: toDate(r.generated_at),
    })),
  });

  // ── Vehicles ───────────────────────────────────────────────────────────
  const vehicles = await readJsonl(join(dir, "vehicles.jsonl"));
  console.log(`  vehicles: ${vehicles.length}`);
  await prisma.vehicle.createMany({
    data: vehicles.map((r) => ({
      vehicleId: r.vehicle_id as string,
      kind: r.kind as string,
      operatorId: r.operator_id as string,
      registration: (r.registration as string) ?? null,
      modelId: (r.model_id as string) ?? null,
      status: (r.status as string) ?? null,
      seatConfig: r.seat_config ?? undefined,
      gseType: (r.gse_type as string) ?? null,
      railType: (r.rail_type as string) ?? null,
      baseIata: (r.base_iata as string) ?? null,
      homeIata: (r.home_iata as string) ?? null,
      schemaVersion: r.schema_version as number,
      generatedAt: toDate(r.generated_at),
    })),
  });

  // ── Ownership history ──────────────────────────────────────────────────
  const ownership = await readJsonl(join(dir, "ownership_history.jsonl"));
  console.log(`  ownership_history: ${ownership.length}`);
  await prisma.ownershipHistory.createMany({
    data: ownership.map((r) => ({
      vehicleId: r.vehicle_id as string,
      sequence: r.sequence as number,
      fromOperatorId: r.from_operator_id as string,
      toOperatorId: r.to_operator_id as string,
      transferType: r.transfer_type as string,
      validTime: toDate(r.valid_time),
    })),
  });

  // ── Staff ──────────────────────────────────────────────────────────────
  const staff = await readJsonl(join(dir, "staff.jsonl"));
  console.log(`  staff: ${staff.length}`);
  await prisma.staff.createMany({
    data: staff.map((r) => ({
      staffId: r.staff_id as string,
      givenName: r.given_name as string,
      familyName: r.family_name as string,
      roleClass: r.role_class as string,
      role: r.role as string,
      operatorId: r.operator_id as string,
      baseIata: r.base_iata as string,
      hireDate: toDate(r.hire_date),
      certifications: r.certifications ?? [],
      schemaVersion: r.schema_version as number,
      generatedAt: toDate(r.generated_at),
    })),
  });

  // ── Facilities ─────────────────────────────────────────────────────────
  const facilities = await readJsonl(join(dir, "facilities.jsonl"));
  console.log(`  facilities: ${facilities.length}`);
  await prisma.facility.createMany({
    data: facilities.map((r) => ({
      facilityId: r.facility_id as string,
      facilityType: r.facility_type as string,
      operatorId: r.operator_id as string,
      airportIata: r.airport_iata as string,
      capacityUnits: r.capacity_units as number,
      schemaVersion: r.schema_version as number,
      generatedAt: toDate(r.generated_at),
    })),
  });

  // ── Customers ──────────────────────────────────────────────────────────
  const customers = await readJsonl(join(dir, "carrier_customers.jsonl"));
  console.log(`  carrier_customers: ${customers.length}`);
  await prisma.carrierCustomer.createMany({
    data: customers.map((r) => ({
      customerId: r.customer_id as string,
      customerType: r.customer_type as string,
      companyName: r.company_name as string,
      operatorId: r.operator_id as string,
      accountManagerId: (r.account_manager_id as string) ?? null,
      contractStart: toDate(r.contract_start),
      monthlyVolumeKg: (r.monthly_volume_kg as number) ?? null,
      schemaVersion: r.schema_version as number,
      generatedAt: toDate(r.generated_at),
    })),
  });

  // ── Cargo ──────────────────────────────────────────────────────────────
  const cargo = await readJsonl(join(dir, "cargo.jsonl"));
  console.log(`  cargo: ${cargo.length}`);
  await prisma.cargo.createMany({
    data: cargo.map((r) => ({
      cargoId: r.cargo_id as string,
      customerId: r.customer_id as string,
      operatorId: r.operator_id as string,
      originIata: r.origin_iata as string,
      destinationIata: r.destination_iata as string,
      assignedVehicleId: (r.assigned_vehicle_id as string) ?? null,
      weightKg: r.weight_kg as number,
      cargoType: r.cargo_type as string,
      validTime: toDate(r.valid_time),
      schemaVersion: r.schema_version as number,
      generatedAt: toDate(r.generated_at),
    })),
  });

  // ── Routes ─────────────────────────────────────────────────────────────
  const routes = await readJsonl(join(dir, "routes.jsonl"));
  console.log(`  routes: ${routes.length}`);
  await prisma.route.createMany({
    data: routes.map((r) => ({
      routeId: r.route_id as string,
      operatorId: r.operator_id as string,
      vehicleId: r.vehicle_id as string,
      routeType: r.route_type as string,
      baseIata: r.base_iata as string,
      legs: r.legs ?? [],
      schemaVersion: r.schema_version as number,
      generatedAt: toDate(r.generated_at),
    })),
  });

  // ── Orders ─────────────────────────────────────────────────────────────
  const orders = await readJsonl(join(dir, "orders.jsonl"));
  console.log(`  orders: ${orders.length}`);
  await prisma.asseticOrder.createMany({
    data: orders.map((r) => ({
      orderId: r.order_id as string,
      customerId: r.customer_id as string,
      operatorId: r.operator_id as string,
      orderType: r.order_type as string,
      accountManagerId: (r.account_manager_id as string) ?? null,
      tripManagerId: (r.trip_manager_id as string) ?? null,
      originIata: r.origin_iata as string,
      destinationIata: r.destination_iata as string,
      plannedLegs: r.planned_legs ?? [],
      transitRouteIds: r.transit_route_ids ?? [],
      orderedOn: toDate(r.ordered_on),
      status: r.status as string,
      passengerGroup: r.passenger_group ?? undefined,
      freight: r.freight ?? undefined,
      schemaVersion: r.schema_version as number,
      generatedAt: toDate(r.generated_at),
    })),
  });

  // ── Passengers ─────────────────────────────────────────────────────────
  const passengersFile = await readFile(join(dir, "passengers.jsonl"), "utf-8").catch(() => "");
  const passengers = passengersFile.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as JsonlRecord);
  if (passengers.length > 0) {
    console.log(`  passengers: ${passengers.length}`);
    await prisma.passenger.createMany({
      data: passengers.map((r) => ({
        passengerId: r.passenger_id as string,
        givenName: r.given_name as string,
        familyName: r.family_name as string,
        passengerType: r.passenger_type as string,
        orderId: (r.order_id as string) ?? null,
        operatorId: r.operator_id as string,
        originIata: r.origin_iata as string,
        destinationIata: r.destination_iata as string,
        validTime: toDate(r.valid_time),
        schemaVersion: r.schema_version as number,
        generatedAt: toDate(r.generated_at),
      })),
    });
  }

  // ── Transit events (unified state-transition log) ─────────────────────
  const tevFile = await readFile(join(dir, "transit_events.jsonl"), "utf-8").catch(() => "");
  const tevRecords = tevFile.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as JsonlRecord);
  if (tevRecords.length > 0) {
    console.log(`  transit_events: ${tevRecords.length}`);
    await prisma.transitEvent.createMany({
      data: tevRecords.map((r) => ({
        eventId: r.event_id as string,
        subjectType: r.subject_type as string,
        cargoId: (r.cargo_id as string) ?? null,
        passengerId: (r.passenger_id as string) ?? null,
        sequence: r.sequence as number,
        eventType: r.event_type as string,
        fromState: r.from_state as string,
        toState: r.to_state as string,
        locationIata: r.location_iata as string,
        vehicleId: (r.vehicle_id as string) ?? null,
        facilityId: (r.facility_id as string) ?? null,
        actorId: (r.actor_id as string) ?? null,
        validTime: new Date(r.valid_time as string),
        schemaVersion: r.schema_version as number,
        generatedAt: toDate(r.generated_at),
      })),
    });
  }

  console.log("Load complete.");
}

// CLI entry point
const dir = process.argv[process.argv.indexOf("--dir") + 1] ?? "./datagen-out";
const files = await readdir(dir).catch(() => null);
if (!files) {
  console.error(`Directory not found: ${dir}`);
  console.error("Run assetic-datagen first, or specify --dir <path>");
  process.exit(1);
}

await loadAll(dir);
await prisma.$disconnect();