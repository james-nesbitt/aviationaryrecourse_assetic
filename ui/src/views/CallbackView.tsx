import React, { useEffect, useState } from "react";
import { getUser, handleCallback } from "../lib/auth.js";
import { apiGet, type Me } from "../lib/api.js";
import { landingPath } from "../AppLayout.js";
import { useNavigate } from "react-router-dom";

export function CallbackView(): React.ReactElement {
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  // After the token exchange, send the user to their own workspace: the admin
  // panel, a role dashboard, or their personal schedule when the account is
  // linked to a staff record.
  useEffect(() => {
    handleCallback()
      .then(async () => {
        const roles = getUser()?.roles ?? [];
        const me = await apiGet<Me>("/api/me").catch(() => null);
        navigate(landingPath(roles, Boolean(me?.staff)), { replace: true });
      })
      .catch((e) => setError(String(e)));
  }, [navigate]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#1a1a2e",
        fontFamily: "system-ui, sans-serif",
        color: "#eee",
      }}
    >
      {error ? (
        <div style={{ textAlign: "center" }}>
          <p style={{ color: "#ff5555" }}>Login failed: {error}</p>
          <a href="/login" style={{ color: "#8be9fd" }}>
            Try again
          </a>
        </div>
      ) : (
        <p>Completing login…</p>
      )}
    </div>
  );
}