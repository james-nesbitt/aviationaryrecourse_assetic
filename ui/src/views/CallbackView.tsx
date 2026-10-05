import React, { useEffect, useState } from "react";
import { handleCallback } from "../lib/auth.js";
import { useNavigate } from "react-router-dom";

export function CallbackView(): React.ReactElement {
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    handleCallback()
      .then(() => navigate("/"))
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