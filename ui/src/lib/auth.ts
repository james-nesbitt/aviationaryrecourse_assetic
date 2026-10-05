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
  const token = getToken();
  if (!token) return false;
  // Check if token is expired
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    const exp = payload.exp * 1000; // seconds to ms
    if (Date.now() >= exp) {
      // Token expired — don't clear yet, let apiFetch try refresh
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Refresh the access token using the stored refresh token.
 * Returns true on success, false if no refresh token or refresh failed.
 */
async function doTokenRefresh(): Promise<boolean> {
  const refreshToken = sessionStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;

  const cfg = await loadConfig();
  const tokenUrl = `${cfg.keycloakUrl}/realms/${cfg.realm}/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  try {
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) return false;
    const tokens = (await res.json()) as { access_token: string; refresh_token?: string };
    setTokens(tokens.access_token, tokens.refresh_token);
    return true;
  } catch {
    return false;
  }
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

  const tokenUrl = `${cfg.keycloakUrl}/realms/${cfg.realm}/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

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
 * On 401, attempts token refresh once before redirecting to login.
 */
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  let token = getToken();
  if (!token) {
    // Try refresh once — maybe the token expired but refresh token is still valid
    const refreshed = await doTokenRefresh();
    if (!refreshed) {
      clearTokens();
      window.location.href = "/login";
      throw new Error("Not authenticated");
    }
    token = getToken();
  }

  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token}`);

  let res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    // Token might be expired — try refresh and retry once
    const refreshed = await doTokenRefresh();
    if (refreshed) {
      token = getToken();
      headers.set("Authorization", `Bearer ${token}`);
      res = await fetch(path, { ...options, headers });
    }
    if (res.status === 401) {
      clearTokens();
      window.location.href = "/login";
    }
  }
  return res;
}