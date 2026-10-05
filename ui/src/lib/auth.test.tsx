import { describe, it, expect, beforeEach, vi } from "vitest";

// Test the UI auth module's pure functions: token storage, expiry check,
// getUser parsing. Mock sessionStorage and fetch.

function mockSessionStorage(): Storage {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() { return Object.keys(store).length; },
  };
}

beforeEach(() => {
  vi.stubGlobal("sessionStorage", mockSessionStorage());
});

// Import after mock is set up — vitest hoists imports, so we use dynamic import
async function loadAuth() {
  return await import("../lib/auth.js");
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.`;
}

describe("UI auth: getToken / setTokens / clearTokens", () => {
  it("getToken returns null when no token stored", async () => {
    const auth = await loadAuth();
    expect(auth.getToken()).toBeNull();
  });

  it("isLoggedIn returns false when no token", async () => {
    const auth = await loadAuth();
    expect(auth.isLoggedIn()).toBe(false);
  });

  it("isLoggedIn returns true for valid unexpired token", async () => {
    const auth = await loadAuth();
    const future = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt({
      sub: "123",
      preferred_username: "admin",
      realm_access: { roles: ["asset_manager"] },
      exp: future,
    });
    sessionStorage.setItem("assetic_token", token);
    expect(auth.isLoggedIn()).toBe(true);
  });

  it("isLoggedIn returns false for expired token", async () => {
    const auth = await loadAuth();
    const past = Math.floor(Date.now() / 1000) - 100;
    const token = makeJwt({
      sub: "123",
      preferred_username: "admin",
      realm_access: { roles: ["asset_manager"] },
      exp: past,
    });
    sessionStorage.setItem("assetic_token", token);
    expect(auth.isLoggedIn()).toBe(false);
  });
});

describe("UI auth: getUser", () => {
  it("returns null when no token", async () => {
    const auth = await loadAuth();
    expect(auth.getUser()).toBeNull();
  });

  it("parses user from valid JWT", async () => {
    const auth = await loadAuth();
    const token = makeJwt({
      sub: "user-123",
      preferred_username: "tripmgr",
      email: "tripmgr@assetic.local",
      realm_access: { roles: ["trip_manager", "default-roles-assetic"] },
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    sessionStorage.setItem("assetic_token", token);
    const user = auth.getUser();
    expect(user).not.toBeNull();
    expect(user!.username).toBe("tripmgr");
    expect(user!.sub).toBe("user-123");
    expect(user!.email).toBe("tripmgr@assetic.local");
    expect(user!.roles).toContain("trip_manager");
  });
});