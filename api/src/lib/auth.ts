import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

/**
 * Keycloak OIDC token verification.
 * POC-grade: verifies the JWT signature against the realm's JWKS endpoint
 * and checks the `iss` claim. Extracts roles from realm_access.roles.
 *
 * Config via env:
 *   KEYCLOAK_URL      — e.g. http://localhost:8080
 *   KEYCLOAK_REALM    — e.g. assetic
 *   KEYCLOAK_CLIENT_ID — e.g. assetic-api
 */

const keycloakUrl = process.env.KEYCLOAK_URL ?? "http://localhost:8080";
const realm = process.env.KEYCLOAK_REALM ?? "assetic";
const clientId = process.env.KEYCLOAK_CLIENT_ID ?? "assetic-api";

const jwksUrl = new URL(`${keycloakUrl}/realms/${realm}/protocol/openid-connect/certs`);
const JWKS = createRemoteJWKSet(jwksUrl);

const expectedIssuer = `${keycloakUrl}/realms/${realm}`;

export interface AsseticUser {
  sub: string;
  username: string;
  email?: string;
  roles: string[];
  raw: JWTPayload;
}

export async function verifyToken(token: string): Promise<AsseticUser> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: expectedIssuer,
  });

  const realmAccess = payload.realm_access as { roles?: string[] } | undefined;
  const roles = realmAccess?.roles ?? [];

  return {
    sub: payload.sub ?? "",
    username: (payload.preferred_username ?? payload.sub ?? "") as string,
    email: payload.email as string | undefined,
    roles,
    raw: payload,
  };
}

export function hasRole(user: AsseticUser, role: string): boolean {
  return user.roles.includes(role);
}

export function requireRole(user: AsseticUser, role: string): void {
  if (!hasRole(user, role)) {
    const err = new Error(`Forbidden: missing role '${role}'`) as Error & {
      statusCode: number;
    };
    err.statusCode = 403;
    throw err;
  }
}