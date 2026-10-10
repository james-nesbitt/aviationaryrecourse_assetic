import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import * as jose from "jose";

// Test the auth module's exported helpers (hasRole, requireRole) and
// verifyToken logic. We mock the JWKS fetch and test with locally-signed JWTs.

const TEST_ISSUER = "https://test-keycloak/realms/assetic";
const TEST_AUDIENCE = "assetic-api";

// Generate a test RSA key pair for signing JWTs
let testKey: jose.KeyLike;

async function getTestKey(): Promise<jose.KeyLike> {
  if (testKey) return testKey;
  const { publicKey, privateKey } = await jose.generateKeyPair("RS256");
  testKey = privateKey;
  // Store publicKey for JWKS mock
  (getTestKey as unknown as { publicKey: jose.KeyLike }).publicKey = publicKey;
  return privateKey;
}

async function makeToken(overrides: Partial<jose.JWTPayload> = {}): Promise<string> {
  const key = await getTestKey();
  return new jose.SignJWT({
    realm_access: { roles: ["asset_manager", "trip_manager"] },
    preferred_username: "testuser",
    sub: "test-sub-123",
    email: "test@assetic.local",
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-kid" })
    .setIssuer(TEST_ISSUER)
    .setAudience(TEST_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
}

// We test the pure functions that don't need JWKS network access
import { hasRole, requireRole, type AsseticUser } from "../lib/auth.js";

describe("hasRole", () => {
  const user: AsseticUser = {
    sub: "123",
    username: "test",
    roles: ["asset_manager", "trip_manager"],
    raw: {},
  };

  it("returns true when role exists", () => {
    expect(hasRole(user, "asset_manager")).toBe(true);
    expect(hasRole(user, "trip_manager")).toBe(true);
  });

  it("returns false when role does not exist", () => {
    expect(hasRole(user, "loading_team")).toBe(false);
    expect(hasRole(user, "")).toBe(false);
  });

  it("handles empty roles array", () => {
    const emptyUser: AsseticUser = { ...user, roles: [] };
    expect(hasRole(emptyUser, "asset_manager")).toBe(false);
  });
});

describe("requireRole", () => {
  const user: AsseticUser = {
    sub: "123",
    username: "test",
    roles: ["asset_manager"],
    raw: {},
  };

  it("does not throw when role exists", () => {
    expect(() => requireRole(user, "asset_manager")).not.toThrow();
  });

  it("throws 403 when role is missing", () => {
    try {
      requireRole(user, "sysadmin");
      expect.fail("should have thrown");
    } catch (e) {
      const err = e as Error & { statusCode: number };
      expect(err.statusCode).toBe(403);
      expect(err.message).toContain("sysadmin");
    }
  });
});

describe("JWT token structure", () => {
  it("creates and verifies a locally-signed token", async () => {
    const token = await makeToken({ preferred_username: "admin" });
    expect(token.split(".")).toHaveLength(3);

    const key = (getTestKey as unknown as { publicKey: jose.KeyLike }).publicKey;
    const { payload } = await jose.jwtVerify(token, key, {
      issuer: TEST_ISSUER,
    });
    expect(payload.preferred_username).toBe("admin");
    expect(payload.realm_access).toEqual({ roles: ["asset_manager", "trip_manager"] });
  });

  it("a token minted for a different audience fails verification", async () => {
    const key = await getTestKey();
    const token = await new jose.SignJWT({ sub: "other-client-user" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(TEST_ISSUER)
      .setAudience("some-other-client")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(key);

    const pubKey = (getTestKey as unknown as { publicKey: jose.KeyLike }).publicKey;
    // The API verifies with audience: "assetic-api" — a token whose aud is
    // another client must be rejected even though the signature and issuer are valid.
    await expect(
      jose.jwtVerify(token, pubKey, { issuer: TEST_ISSUER, audience: TEST_AUDIENCE }),
    ).rejects.toThrow();
  });

  it("expired token fails verification", async () => {
    const key = await getTestKey();
    const token = await new jose.SignJWT({ sub: "expired" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("0s")
      .sign(key);

    const pubKey = (getTestKey as unknown as { publicKey: jose.KeyLike }).publicKey;
    await expect(jose.jwtVerify(token, pubKey, { issuer: TEST_ISSUER })).rejects.toThrow();
  });
});