import Fastify from "fastify";
import cors from "@fastify/cors";
import { authHook } from "./lib/authHook.js";
import { snakeKeys } from "./lib/serialize.js";
import { registerDomainRoutes } from "./routes/domain.js";
import { registerJournalRoutes } from "./routes/journal.js";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = Fastify({ logger: true });

// CORS — allow the UI origin
await app.register(cors, {
  origin: process.env.UI_URL ?? "http://localhost:5173",
  credentials: true,
});

// Auth hook — runs on every request, skips health paths
app.addHook("onRequest", authHook);

// Emit snake_case keys on domain data so Prisma-backed and $queryRaw-backed
// routes agree. /api/auth/config is client bootstrap config, not domain data:
// its camelCase keys are part of the UI contract and are left untouched.
app.addHook("preSerialization", async (request, _reply, payload) => {
  const path = request.url.split("?")[0];
  if (!path.startsWith("/api/")) return payload;
  if (path === "/api/auth/config" || path === "/api/health") return payload;
  return snakeKeys(payload);
});

// Health
app.get("/health", async () => ({ status: "ok" }));
app.get("/healthz", async () => "ok");
app.get("/api/health", async () => ({ status: "ok" }));

// Auth config endpoint — tells the UI where Keycloak is
app.get("/api/auth/config", async () => ({
  keycloakUrl: process.env.KEYCLOAK_URL ?? "http://localhost:8080",
  realm: process.env.KEYCLOAK_REALM ?? "assetic",
  clientId: process.env.KEYCLOAK_UI_CLIENT_ID ?? "assetic-ui",
}));

// Domain + journal routes
await registerDomainRoutes(app);
await registerJournalRoutes(app);

app.listen({ port: PORT, host: HOST }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});