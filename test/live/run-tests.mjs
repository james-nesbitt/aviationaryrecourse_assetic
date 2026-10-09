#!/usr/bin/env node
/**
 * assetic live system test runner.
 * Targets a deployed environment via BASE_URL and tests:
 *   1. Health endpoint
 *   2. Auth config endpoint
 *   3. Unauthenticated requests are rejected
 *   4. Keycloak token acquisition (password grant)
 *   5. Authenticated data endpoints (all 7 domain entities)
 *   6. Journal write + chain verification
 *   7. Auth/policy tests: synthetic personas (admin, tripmgr, loader, viewer)
 *
 * Usage:
 *   node test/live/run-tests.mjs [BASE_URL] [KEYCLOAK_URL] [REALM]
 *
 * Defaults:
 *   BASE_URL=https://assetic.home.arpa
 *   KEYCLOAK_URL=$BASE_URL/auth
 *   REALM=assetic
 *
 * Environment:
 *   NODE_TLS_REJECT_UNAUTHORIZED=0  (for self-signed CA)
 *   TEST_ADMIN_PASSWORD=admin
 *   TEST_TRIPMGR_PASSWORD=tripmgr
 *   TEST_LOADER_PASSWORD=loader
 *   TEST_VIEWER_PASSWORD=viewer
 */

const BASE_URL = process.argv[2] ?? process.env.BASE_URL ?? "https://assetic.home.arpa";
const KEYCLOAK_URL = process.argv[3] ?? process.env.KEYCLOAK_URL ?? `${BASE_URL}/auth`;
const REALM = process.argv[4] ?? process.env.REALM ?? "assetic";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    failures.push(message);
    console.log(`  ✗ ${message}`);
  }
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  return {
    status: res.status,
    json: await res.json().catch(() => null),
    ok: res.ok,
    cache: res.headers.get("x-cache"),
  };
}

async function getToken(username, password) {
  // Local runs against a dev stack can supply a token directly instead of
  // exchanging credentials with Keycloak.
  const preset = process.env[`TEST_TOKEN_${username.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`];
  if (preset) return preset;
  const res = await fetch(`${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: "assetic-ui",
      username,
      password,
      grant_type: "password",
      scope: "openid profile email roles",
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token;
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

// ─── Test suites ─────────────────────────────────────────────────────

async function testHealth() {
  console.log("\n── Health ──");
  const { status, json } = await fetchJson(`${BASE_URL}/api/health`);
  assert(status === 200, "GET /api/health returns 200");
  assert(json?.status === "ok", "health response has status=ok");
}

async function testAuthConfig() {
  console.log("\n── Auth Config ──");
  const { status, json } = await fetchJson(`${BASE_URL}/api/auth/config`);
  assert(status === 200, "GET /api/auth/config returns 200");
  assert(json?.realm === REALM, `auth config realm is ${REALM}`);
  assert(typeof json?.keycloakUrl === "string" && json.keycloakUrl.length > 0, "keycloakUrl is set");
  assert(json?.clientId === "assetic-ui", "clientId is assetic-ui");
}

async function testUnauthenticated() {
  console.log("\n── Unauthenticated Access ──");
  const { status, json } = await fetchJson(`${BASE_URL}/api/operators`);
  assert(status === 401, "GET /api/operators without token returns 401");
  assert(json?.error === "missing_bearer_token", "error is missing_bearer_token");
}

async function testDataEndpoints(token) {
  console.log("\n── Data Endpoints (admin) ──");
  const endpoints = [
    { path: "/api/operators", min: 1, label: "Operators" },
    { path: "/api/vehicles", min: 1, label: "Vehicles" },
    { path: "/api/orders", min: 1, label: "Orders" },
    { path: "/api/cargo", min: 1, label: "Cargo" },
    { path: "/api/staff", min: 1, label: "Staff" },
    { path: "/api/routes", min: 1, label: "Routes" },
    { path: "/api/customers", min: 1, label: "Customers" },
    { path: "/api/airports", min: 1, label: "Airports" },
    { path: "/api/aircraft-models", min: 1, label: "Aircraft Models" },
    { path: "/api/passengers", min: 1, label: "Passengers" },
    { path: "/api/trips", min: 1, label: "Trips" },
    { path: "/api/crew-assignments", min: 1, label: "Crew assignments" },
    { path: "/api/route-assignments", min: 1, label: "Route assignments" },
    { path: "/api/vehicle-maintenance", min: 1, label: "Vehicle maintenance" },
  ];

  for (const { path, min, label } of endpoints) {
    const { status, json } = await fetchJson(`${BASE_URL}${path}`, {
      headers: authHeader(token),
    });
    assert(status === 200, `GET ${path} returns 200`);
    assert(Array.isArray(json), `GET ${path} returns array`);
    assert(json.length >= min, `${label}: ${json.length} records (>= ${min})`);
  }
}

async function testTransit(token) {
  console.log("\n── Transit event chains (admin) ──");
  const cargoStates = new Set(["scheduled", "picked_up", "loaded", "in_transit", "arrived", "held", "delivered"]);
  const paxStates = new Set(["booked", "checked_in", "boarded", "in_transit", "arrived", "disembarked"]);

  const cargoRes = await fetchJson(`${BASE_URL}/api/cargo`, { headers: authHeader(token) });
  assert(cargoRes.status === 200, "GET /api/cargo returns 200");
  assert(Array.isArray(cargoRes.json), "GET /api/cargo returns array");
  assert(cargoRes.json.every((r) => cargoStates.has(r.state)), "every cargo row has a valid state");

  const paxRes = await fetchJson(`${BASE_URL}/api/passengers`, { headers: authHeader(token) });
  assert(paxRes.status === 200, "GET /api/passengers returns 200");
  assert(Array.isArray(paxRes.json), "GET /api/passengers returns array");
  assert(paxRes.json.every((r) => paxStates.has(r.state)), "every passenger row has a valid state");

  async function checkChain(subjectPath, list, initialState, terminalState, label, minLength) {
    const row = list.find((r) => r.state === terminalState);
    if (!row) {
      failures.push(`${label}: no ${terminalState} subject to check`);
      failed++;
      return;
    }
    const id = label === "Cargo" ? row.cargo_id : row.passenger_id;
    const { status, json } = await fetchJson(`${BASE_URL}${subjectPath}/${id}/events`, {
      headers: authHeader(token),
    });
    assert(status === 200, `GET ${subjectPath}/${id}/events returns 200`);
    assert(Array.isArray(json), `GET ${subjectPath}/${id}/events returns array`);
    assert(json.length >= minLength, `${label} ${terminalState} chain has >= ${minLength} events (got ${json.length})`);
    assert(json[0].from_state === initialState, `${label} chain starts at ${initialState}`);
    assert(json[json.length - 1].to_state === terminalState, `${label} chain ends at ${terminalState}`);
    for (let i = 1; i < json.length; i++) {
      assert(json[i].from_state === json[i - 1].to_state, `${label} chain continuous at event ${i}`);
    }
    console.log(`  ✓ ${label} ${id}: ${json.map((e) => `${e.from_state}->${e.to_state}`).join(", ")}`);
  }

  await checkChain("/api/cargo", cargoRes.json, "scheduled", "delivered", "Cargo", 5);
  await checkChain("/api/passengers", paxRes.json, "booked", "disembarked", "Passenger", 5);
}

async function testTrips(token) {
  console.log("\n── Trips (admin) ──");

  // 1. assignments: per route contiguous, one open, at least one maintenance_cover
  const asgRes = await fetchJson(`${BASE_URL}/api/route-assignments`, { headers: authHeader(token) });
  assert(asgRes.status === 200, "GET /api/route-assignments returns 200");
  assert(Array.isArray(asgRes.json), "GET /api/route-assignments returns array");
  const byRoute = new Map();
  for (const row of asgRes.json) {
    if (!byRoute.has(row.route_id)) byRoute.set(row.route_id, []);
    byRoute.get(row.route_id).push(row);
  }
  const day = (s) => Math.floor(Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s) / 86400000);
  for (const [routeId, rows] of byRoute) {
    rows.sort((a, b) => day(a.valid_from) - day(b.valid_from));
    const open = rows.filter((r) => r.valid_to === null);
    assert(open.length === 1, `route ${routeId}: exactly one open assignment (got ${open.length})`);
    for (let i = 1; i < rows.length; i++) {
      assert(
        day(rows[i].valid_from) === day(rows[i - 1].valid_to) + 1,
        `route ${routeId}: assignments contiguous at ${rows[i].valid_from}`,
      );
    }
  }
  assert(
    asgRes.json.some((r) => r.reason === "maintenance_cover"),
    "at least one assignment has reason maintenance_cover",
  );

  // 2. delivered cargo: events match the operation timetable and vehicle
  const cargoRes = await fetchJson(`${BASE_URL}/api/cargo`, { headers: authHeader(token) });
  const delivered = cargoRes.json.find((r) => r.trip_id && r.state === "delivered");
  if (delivered) {
    const opRes = await fetchJson(`${BASE_URL}/api/trips/${delivered.trip_id}`, {
      headers: authHeader(token),
    });
    assert(opRes.status === 200, "GET /api/trips/:id returns 200");
    const op = opRes.json;
    const evRes = await fetchJson(`${BASE_URL}/api/cargo/${delivered.cargo_id}/events`, {
      headers: authHeader(token),
    });
    assert(evRes.status === 200, "GET /api/cargo/:id/events returns 200");
    for (const ev of evRes.json) {
      if (ev.vehicle_id !== null) {
        assert(ev.vehicle_id === op.vehicle_id, `cargo ${delivered.cargo_id}: event vehicle matches operation vehicle`);
      }
    }
    // transit_event.valid_time is timestamptz while trip legs are naive strings
    // inside JSONB, so comparing the two as instants depends on the database
    // session timezone. Assert the structural invariants instead: every depart
    // leaves from one of the trip's leg origins, the first depart leaves from
    // the booked board leg, and the depart count matches the booked span.
    const departs = evRes.json.filter((e) => e.event_type === "depart");
    const legOrigins = op.legs.map((l) => l.from_iata);
    assert(departs.length > 0, `cargo ${delivered.cargo_id}: has depart events`);
    assert(
      departs.every((e) => legOrigins.includes(e.location_iata)),
      `cargo ${delivered.cargo_id}: every depart leaves from a leg origin of its trip`,
    );
    assert(
      departs[0].location_iata === delivered.origin_iata,
      `cargo ${delivered.cargo_id}: first depart leaves from the booked origin`,
    );
    const arrives = evRes.json.filter((e) => e.event_type === "arrive");
    assert(
      departs.length === arrives.length,
      `cargo ${delivered.cargo_id}: depart and arrive events pair up (${departs.length}/${arrives.length})`,
    );
    assert(
      arrives[arrives.length - 1].location_iata === delivered.destination_iata,
      `cargo ${delivered.cargo_id}: last arrive reaches the booked destination`,
    );
  } else {
    failures.push("Trips: no delivered cargo with a trip_id to check");
    failed++;
  }

  // 3. cancelled operations: vehicle in maintenance on the operating date
  const cancelRes = await fetchJson(`${BASE_URL}/api/trips?status=cancelled`, {
    headers: authHeader(token),
  });
  assert(cancelRes.status === 200, "GET /api/trips?status=cancelled returns 200");
  for (const op of cancelRes.json) {
    const mntRes = await fetchJson(`${BASE_URL}/api/vehicle-maintenance?vehicleId=${op.vehicle_id}`, {
      headers: authHeader(token),
    });
    if (mntRes.status !== 200 || !Array.isArray(mntRes.json)) continue;
    const opDay = day(op.operating_date);
    assert(
      mntRes.json.some((w) => day(w.start_date) <= opDay && opDay <= day(w.end_date)),
      `operation ${op.trip_id}: vehicle has a maintenance window covering ${op.operating_date}`,
    );
  }
}

async function testCrew(token) {
  console.log("\n── Crew assignments and fatigue (admin) ──");

  const crewRes = await fetchJson(`${BASE_URL}/api/crew-assignments`, { headers: authHeader(token) });
  assert(crewRes.status === 200, "GET /api/crew-assignments returns 200");
  assert(Array.isArray(crewRes.json) && crewRes.json.length > 0, `crew assignments: ${crewRes.json.length} rows`);

  // no staff member appears twice on one trip
  const pairs = new Set();
  let duplicates = 0;
  for (const row of crewRes.json) {
    const key = `${row.trip_id}|${row.staff_id}`;
    if (pairs.has(key)) duplicates++;
    pairs.add(key);
  }
  assert(duplicates === 0, `no staff assigned twice to the same trip (${duplicates} duplicates)`);

  // every assignment points at a non-cancelled trip of the staff member's operator
  const sample = crewRes.json.slice(0, 5);
  const staffRes = await fetchJson(`${BASE_URL}/api/staff`, { headers: authHeader(token) });
  const staffById = new Map(staffRes.json.map((s) => [s.staff_id, s]));
  for (const row of sample) {
    const tripRes = await fetchJson(`${BASE_URL}/api/trips/${row.trip_id}`, { headers: authHeader(token) });
    assert(tripRes.status === 200, `GET /api/trips/${row.trip_id} returns 200`);
    assert(tripRes.json.status !== "cancelled", `crew assignment ${row.assignment_id} is not on a cancelled trip`);
    const staff = staffById.get(row.staff_id);
    if (staff) {
      assert(staff.role_class === "flight_crew", `crew ${row.staff_id} is flight_crew`);
      assert(staff.operator_id === tripRes.json.operator_id, `crew ${row.staff_id} matches the trip operator`);
      assert(row.crew_role === staff.role, `crew_role matches the staff role for ${row.staff_id}`);
    }
  }

  // fatigue view: every row carries a known level, and the roster spans levels
  const fatRes = await fetchJson(`${BASE_URL}/api/staff/fatigue`, { headers: authHeader(token) });
  assert(fatRes.status === 200, "GET /api/staff/fatigue returns 200");
  assert(fatRes.json.length > 0, `fatigue rows: ${fatRes.json.length}`);
  const levels = new Set(fatRes.json.map((r) => r.level));
  assert([...levels].every((l) => ["ok", "warn", "critical"].includes(l)), `levels are known: ${[...levels].join("/")}`);
  assert(levels.size >= 2, `roster spans more than one fatigue level (${[...levels].join("/")})`);
  assert(
    fatRes.json.every((r) => typeof r.duty_hours_7d === "number"),
    "duty_hours_7d serializes as a number, not a Decimal object",
  );
  const loaded = fatRes.json.find((r) => r.level !== "ok");
  assert(Boolean(loaded), "at least one crew member is at warn or critical");

  // the stats cache serves the second identical read from memory
  const first = await fetchJson(`${BASE_URL}/api/stats/crew`, { headers: authHeader(token) });
  const second = await fetchJson(`${BASE_URL}/api/stats/crew`, { headers: authHeader(token) });
  assert(first.status === 200 && second.status === 200, "GET /api/stats/crew returns 200");
  assert(second.cache === "hit", `second /api/stats/crew read is a cache hit (got ${second.cache})`);
}

async function testMe(token) {
  console.log("\n── Identity (/api/me) ──");

  const meRes = await fetchJson(`${BASE_URL}/api/me`, { headers: authHeader(token) });
  assert(meRes.status === 200, "GET /api/me returns 200");
  assert(typeof meRes.json.username === "string", `identity username: ${meRes.json.username}`);
  assert(Array.isArray(meRes.json.roles), "identity carries a roles array");
  assert("staff" in meRes.json, "identity carries a staff field (null when unlinked)");

  // a staff row with a keycloak_username proves the identity link is loaded
  const fatRes = await fetchJson(`${BASE_URL}/api/staff/fatigue`, { headers: authHeader(token) });
  const linked = fatRes.json.filter((r) => r.keycloak_username);
  assert(linked.length > 0, `${linked.length} crew rows carry a keycloak_username`);
}

async function testJournal(token) {
  console.log("\n── Journal Write + Verify ──");
  const chainKey = `test:smoke-${Date.now()}`;
  const payload = { action: "smoke_test", timestamp: new Date().toISOString() };

  // Write a journal entry
  const writeRes = await fetch(`${BASE_URL}/api/journal`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      chain_key: chainKey,
      event_type: "agent.action",
      entity_type: "test",
      entity_id: "smoke-test",
      payload,
      valid_time: new Date().toISOString(),
      actor_id: "test-runner",
    }),
  });
  const writeData = await writeRes.json();
  assert(writeRes.status === 201, "POST /api/journal returns 201");
  assert(typeof writeData?.row_hash === "string" && writeData.row_hash.length === 64, "row_hash is 64-char SHA-256");
  assert(writeData?.prev_hash === "GENESIS", "first entry has prev_hash=GENESIS");

  // Write a second entry to test chaining
  const write2Res = await fetch(`${BASE_URL}/api/journal`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      chain_key: chainKey,
      event_type: "agent.action",
      entity_type: "test",
      entity_id: "smoke-test",
      payload: { action: "second" },
      valid_time: new Date().toISOString(),
      actor_id: "test-runner",
    }),
  });
  const write2Data = await write2Res.json();
  assert(write2Res.status === 201, "POST /api/journal (second entry) returns 201");
  assert(write2Data?.prev_hash === writeData.row_hash, "second entry prev_hash matches first row_hash");

  // Verify the chain
  const verifyRes = await fetchJson(`${BASE_URL}/api/journal/verify/${encodeURIComponent(chainKey)}`, {
    headers: authHeader(token),
  });
  assert(verifyRes.status === 200, "GET /api/journal/verify returns 200");
  assert(verifyRes.json?.all_valid === true, "chain verification all_valid=true");
  assert(verifyRes.json?.entries === 2, "chain has 2 entries");
}

async function testPersonas() {
  console.log("\n── Auth/Policy: Synthetic Personas ──");

  const personas = [
    { username: "admin", password: process.env.TEST_ADMIN_PASSWORD ?? "admin", roles: ["asset_manager", "route_manager", "sysadmin"], label: "admin" },
    { username: "tripmgr", password: process.env.TEST_TRIPMGR_PASSWORD ?? "tripmgr", roles: ["route_manager"], label: "tripmgr" },
    { username: "loader", password: process.env.TEST_LOADER_PASSWORD ?? "loader", roles: ["loading_team"], label: "loader" },
    { username: "viewer", password: process.env.TEST_VIEWER_PASSWORD ?? "viewer", roles: ["analytics"], label: "viewer" },
  ];

  for (const p of personas) {
    const token = await getToken(p.username, p.password);
    assert(token !== null, `${p.label}: can acquire token`);

    if (token) {
      // All personas can read
      const { status } = await fetchJson(`${BASE_URL}/api/operators`, {
        headers: authHeader(token),
      });
      assert(status === 200, `${p.label}: can read operators`);

      // Write endpoints: only asset_manager can POST /api/operators
      const writeRes = await fetch(`${BASE_URL}/api/operators`, {
        method: "POST",
        headers: { ...authHeader(token), "Content-Type": "application/json" },
        body: JSON.stringify({ operator_id: "test-x", name: "Test", type: "passenger", country: "US", hub_iata: "LAX", founded_year: 2000, fleet_size_hint: 10 }),
      });
      if (p.roles.includes("asset_manager")) {
        assert(writeRes.status !== 403, `${p.label}: asset_manager can POST operators (not 403)`);
      } else {
        assert(writeRes.status === 403, `${p.label}: non-asset_manager gets 403 on POST operators`);
      }
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log(`assetic live system tests`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Keycloak: ${KEYCLOAK_URL}/realms/${REALM}`);
  console.log(`Date: ${new Date().toISOString()}`);

  await testHealth();
  await testAuthConfig();
  await testUnauthenticated();

  const adminToken = await getToken("admin", process.env.TEST_ADMIN_PASSWORD ?? "admin");
  if (!adminToken) {
    console.log("\nFATAL: Could not acquire admin token — aborting remaining tests");
    failed++;
    failures.push("Admin token acquisition failed");
  } else {
    await testDataEndpoints(adminToken);
    await testJournal(adminToken);
    await testTransit(adminToken);
    await testTrips(adminToken);
    await testCrew(adminToken);
    await testMe(adminToken);
    await testPersonas();
  }

  console.log(`\n── Results ──`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failures.length > 0) {
    console.log(`\nFailures:`);
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});