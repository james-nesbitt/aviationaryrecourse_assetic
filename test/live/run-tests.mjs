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
  return { status: res.status, json: await res.json().catch(() => null), ok: res.ok };
}

async function getToken(username, password) {
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
    { path: "/api/route-operations", min: 1, label: "Route operations" },
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

async function testOperations(token) {
  console.log("\n── Route operations (admin) ──");

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
  const delivered = cargoRes.json.find((r) => r.operation_id && r.state === "delivered");
  if (delivered) {
    const opRes = await fetchJson(`${BASE_URL}/api/route-operations/${delivered.operation_id}`, {
      headers: authHeader(token),
    });
    assert(opRes.status === 200, "GET /api/route-operations/:id returns 200");
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
    const firstDepart = evRes.json.find((e) => e.event_type === "depart");
    if (firstDepart) {
      const parseTs = (s) => Date.parse(s.includes("T") && !s.endsWith("Z") ? `${s}Z` : s);
      const depTimes = op.legs.map((l) => parseTs(l.scheduled_departure));
      assert(
        depTimes.includes(parseTs(firstDepart.valid_time)),
        `cargo ${delivered.cargo_id}: first depart matches a scheduled_departure`,
      );
    }
  } else {
    failures.push("Route operations: no delivered cargo with operation_id to check");
    failed++;
  }

  // 3. cancelled operations: vehicle in maintenance on the operating date
  const cancelRes = await fetchJson(`${BASE_URL}/api/route-operations?status=cancelled`, {
    headers: authHeader(token),
  });
  assert(cancelRes.status === 200, "GET /api/route-operations?status=cancelled returns 200");
  for (const op of cancelRes.json) {
    const mntRes = await fetchJson(`${BASE_URL}/api/vehicle-maintenance?vehicleId=${op.vehicle_id}`, {
      headers: authHeader(token),
    });
    if (mntRes.status !== 200 || !Array.isArray(mntRes.json)) continue;
    const opDay = day(op.operating_date);
    assert(
      mntRes.json.some((w) => day(w.start_date) <= opDay && opDay <= day(w.end_date)),
      `operation ${op.operation_id}: vehicle has a maintenance window covering ${op.operating_date}`,
    );
  }
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
    { username: "admin", password: process.env.TEST_ADMIN_PASSWORD ?? "admin", roles: ["asset_manager", "trip_manager", "sysadmin"], label: "admin" },
    { username: "tripmgr", password: process.env.TEST_TRIPMGR_PASSWORD ?? "tripmgr", roles: ["trip_manager"], label: "tripmgr" },
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
    await testOperations(adminToken);
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