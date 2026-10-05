import React, { useEffect, useState } from "react";
import { login } from "../lib/auth.js";

export function LoginView(): React.ReactElement {
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(): Promise<void> {
    try {
      await login();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#1a1a2e",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ textAlign: "center", color: "#eee" }}>
        <h1 style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>assetic</h1>
        <p style={{ color: "#999", marginBottom: "2rem" }}>
          High-assurance transportation management
        </p>
        {error && <div style={{ color: "#ff5555", marginBottom: "1rem" }}>{error}</div>}
        <button
          onClick={handleLogin}
          style={{
            padding: "12px 32px",
            fontSize: "1rem",
            background: "#8be9fd",
            color: "#1a1a2e",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Sign in with Keycloak
        </button>
      </div>
    </div>
  );
}