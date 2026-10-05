/**
 * Keycloak OIDC auth for the React UI.
 * POC-grade: uses the authorization code flow with PKCE via the browser.
 * Stores the token in sessionStorage; refreshes silently if possible.
 *
 * Config comes from /api/auth/config (the API gateway) on startup.
 */

export interface KeycloakConfig {
  keycloakUrl: string;
  realm: string;
  clientId: string;
}

export interface AsseticUser {
  sub: string;
  username: string;
  email?: string;
  roles: string[];
}

let config: KeycloakConfig | null = null;

export async function loadConfig(): Promise<KeycloakConfig> {
  if (config) return config;
  const res = await fetch("/api/auth/config");
  config = (await res.json()) as KeycloakConfig;
  return config;
}

function buildUrl(config: KeycloakConfig, path: string, params: Record<string, string>): string {
  const url = new URL(`${config.keycloakUrl}/realms/${config.realm}/protocol/openid-connect${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

function randomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (v) => chars[v % chars.length]).join("");
}

async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const TOKEN_KEY = "assetic_token";
const REFRESH_KEY = "assetic_refresh";

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

function setTokens(token: string, refreshToken?: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
  if (refreshToken) sessionStorage.setItem(REFRESH_KEY, refreshToken);
}

function clearTokens(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
}

export function isLoggedIn(): boolean {
  return getToken() !== null;
}

/**
 * Redirect to Keycloak login page with PKCE.
 */
export async function login(): Promise<void> {
  const cfg = await loadConfig();
  const codeVerifier = randomString(64);
  sessionStorage.setItem("pkce_verifier", codeVerifier);
  const codeChallenge = await sha256Base64Url(codeVerifier);

  const redirectUri = window.location.origin + "/callback";

  window.location.href = buildUrl(cfg, "/auth", {
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile email roles",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
}

/**
 * Handle the OAuth callback (exchange code for token).
 */
export async function handleCallback(): Promise<void> {
  const cfg = await loadConfig();
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) throw new Error("No code in callback");

  const codeVerifier = sessionStorage.getItem("pkce_verifier");
  sessionStorage.removeItem("pkce_verifier");
  if (!codeVerifier) throw new Error("Missing PKCE verifier");

  const redirectUri = window.location.origin + "/callback";

  const res = await fetch(
    buildUrl(cfg, "/token", {
      client_id: cfg.clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
    { method: "POST" }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token exchange failed: ${body}`);
  }

  const tokens = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
  };

  setTokens(tokens.access_token, tokens.refresh_token);
}

/**
 * Decode the JWT payload (no verification — the API verifies).
 */
export function getUser(): AsseticUser | null {
  const token = getToken();
  if (!token) return null;

  const payload = token.split(".")[1];
  const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));

  const realmAccess = decoded.realm_access as { roles?: string[] } | undefined;
  return {
    sub: decoded.sub,
    username: decoded.preferred_username ?? decoded.sub,
    email: decoded.email,
    roles: realmAccess?.roles ?? [],
  };
}

export async function logout(): Promise<void> {
  const cfg = await loadConfig();
  const token = getToken();
  clearTokens();

  // Keycloak end-session with redirect back to the app
  window.location.href = buildUrl(cfg, "/logout", {
    client_id: cfg.clientId,
    post_logout_redirect_uri: window.location.origin,
    id_token_hint: token ?? "",
  });
}

/**
 * Authenticated fetch wrapper — adds the Bearer token, handles 401.
 */
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");

  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    clearTokens();
    window.location.href = "/login";
  }
  return res;
}