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
    { path: "/api/facilities", min: 0, label: "Facilities" },
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