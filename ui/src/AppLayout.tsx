import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { getUser, logout } from "./lib/auth.js";

const navItems = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/vehicles", label: "Vehicles" },
  { to: "/operators", label: "Operators" },
  { to: "/orders", label: "Orders" },
  { to: "/cargo", label: "Cargo" },
  { to: "/routes", label: "Routes" },
  { to: "/staff", label: "Staff" },
  { to: "/customers", label: "Customers" },
];

export function AppLayout(): React.ReactElement {
  const user = getUser();
  const navigate = useNavigate();

  async function handleLogout(): Promise<void> {
    await logout();
    navigate("/login");
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <aside
        style={{
          width: 220,
          background: "#1a1a2e",
          color: "#eee",
          padding: "1rem 0",
          flexShrink: 0,
        }}
      >
        <div style={{ padding: "0 1rem 1rem", fontSize: "1.5rem", fontWeight: 700 }}>assetic</div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              style={({ isActive }) => ({
                padding: "0.5rem 1rem",
                color: isActive ? "#8be9fd" : "#eee",
                textDecoration: "none",
                background: isActive ? "#16213e" : "transparent",
                borderLeft: isActive ? "3px solid #8be9fd" : "3px solid transparent",
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ marginTop: "2rem", padding: "0 1rem", fontSize: "0.85rem", color: "#999" }}>
          {user && (
            <>
              <div>{user.username}</div>
              <div style={{ fontSize: "0.75rem", marginTop: 4 }}>
                {user.roles.filter((r) => !r.startsWith("default-")).join(", ") || "no roles"}
              </div>
              <button
                onClick={handleLogout}
                style={{
                  marginTop: 8,
                  padding: "4px 12px",
                  background: "transparent",
                  color: "#ff5555",
                  border: "1px solid #ff5555",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                Logout
              </button>
            </>
          )}
        </div>
      </aside>
      <main style={{ flex: 1, padding: "2rem", background: "#f5f5f5" }}>
        <Outlet />
      </main>
    </div>
  );
}