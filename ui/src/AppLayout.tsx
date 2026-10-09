import React, { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { getUser, logout } from "./lib/auth.js";
import { apiGet, type Me } from "./lib/api.js";

/**
 * Navigation is a short list of workspaces, not a table of contents.
 *
 *  - the admin panel is the entry point to every entity list and detail page,
 *    and belongs to the platform-administrator roles
 *  - Fleet and Operations are role dashboards; administrators see them too
 *  - My Schedule is a person's own record, so it is gated on the caller
 *    having a linked staff record rather than on a role: an administrator
 *    holding the crew role but no staff row has no schedule to show
 *
 * Entity lists are reachable from the admin panel and by links from the
 * dashboards, so they are deliberately absent here.
 */
const ADMIN_ROLES = ["asset_manager", "sysadmin"];

type NavGate = "admin" | "staff" | { role: string };

const navItems: { to: string; label: string; end?: boolean; gate: NavGate }[] = [
  { to: "/", label: "Admin", end: true, gate: "admin" },
  { to: "/fleet", label: "Fleet & Maintenance", gate: { role: "maintenance" } },
  { to: "/operations", label: "Operations Control", gate: { role: "route_manager" } },
  { to: "/my-trips", label: "My Schedule", gate: "staff" },
];

export function visibleNavItems(roles: string[], hasStaffRecord: boolean): typeof navItems {
  const isAdmin = roles.some((r) => ADMIN_ROLES.includes(r));
  return navItems.filter((item) => {
    if (item.gate === "admin") return isAdmin;
    if (item.gate === "staff") return hasStaffRecord;
    return isAdmin || roles.includes(item.gate.role);
  });
}

/** Where a persona belongs when they land: their own workspace. */
export function landingPath(roles: string[], hasStaffRecord: boolean): string {
  if (roles.some((r) => ADMIN_ROLES.includes(r))) return "/";
  if (roles.includes("maintenance")) return "/fleet";
  if (roles.includes("route_manager")) return "/operations";
  if (hasStaffRecord) return "/my-trips";
  return "/";
}

export function AppLayout(): React.ReactElement {
  const user = getUser();
  const navigate = useNavigate();
  const [me, setMe] = useState<Me | null>(null);

  // The identity link decides whether this account has a schedule of its own.
  useEffect(() => {
    apiGet<Me>("/api/me")
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

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
          {visibleNavItems(user?.roles ?? [], Boolean(me?.staff)).map((item) => (
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