import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyToken, type AsseticUser } from "./auth.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: AsseticUser;
  }
}

/**
 * Extract and verify the Bearer token from the Authorization header.
 * Attaches the decoded user to request.user. Returns 401 if missing/invalid.
 */
export async function authHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Skip auth for health checks and login-related endpoints
  const skipPaths = ["/health", "/healthz", "/api/health", "/api/auth/config"];
  if (skipPaths.includes(request.url.split("?")[0])) {
    return;
  }

  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    reply.code(401).send({ error: "missing_bearer_token" });
    return;
  }

  const token = authHeader.slice(7);
  try {
    request.user = await verifyToken(token);
  } catch {
    reply.code(401).send({ error: "invalid_token" });
  }
}