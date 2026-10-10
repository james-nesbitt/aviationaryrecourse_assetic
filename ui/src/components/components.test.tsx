import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { visibleNavItems, landingPath } from "../AppLayout.js";
import { Badge, DataTable, DetailTabs, StatCard, Timeline } from "./index.jsx";
import { DonutBreakdown, LineTrend } from "../charts/index.jsx";

describe("navigation gating", () => {
  it("gives a maintenance manager only the fleet dashboard", () => {
    const labels = visibleNavItems(["maintenance"], false).map((i) => i.label);
    expect(labels).toEqual(["Fleet & Maintenance"]);
  });

  it("gives a route manager only the operations dashboard", () => {
    const labels = visibleNavItems(["route_manager"], false).map((i) => i.label);
    expect(labels).toEqual(["Operations Control"]);
  });

  it("gives an account manager only the accounts dashboard", () => {
    const labels = visibleNavItems(["account_manager"], false).map((i) => i.label);
    expect(labels).toEqual(["Accounts"]);
  });

  it("shows My Schedule only when the account has a staff record", () => {
    expect(visibleNavItems(["crew"], true).map((i) => i.label)).toContain("My Schedule");
    expect(visibleNavItems(["crew"], false).map((i) => i.label)).not.toContain("My Schedule");
  });

  it("withholds My Schedule from an admin who holds the crew role but has no staff record", () => {
    const labels = visibleNavItems(["asset_manager", "crew"], false).map((i) => i.label);
    expect(labels).toContain("Admin");
    expect(labels).toContain("Fleet & Maintenance");
    expect(labels).toContain("Operations Control");
    expect(labels).not.toContain("My Schedule");
  });

  it("gives admin roles the admin panel and both role dashboards", () => {
    for (const role of ["asset_manager", "sysadmin"]) {
      const labels = visibleNavItems([role], false).map((i) => i.label);
      expect(labels).toContain("Admin");
      expect(labels).toContain("Fleet & Maintenance");
      expect(labels).toContain("Operations Control");
    }
  });

  it("withholds the admin panel from non-admin roles", () => {
    expect(visibleNavItems(["maintenance"], false).map((i) => i.label)).not.toContain("Admin");
    expect(visibleNavItems(["route_manager"], true).map((i) => i.label)).not.toContain("Admin");
  });

  it("keeps entity lists out of the navigation", () => {
    const labels = visibleNavItems(["asset_manager", "sysadmin"], true).map((i) => i.label);
    expect(labels).not.toContain("Vehicles");
    expect(labels).not.toContain("Cargo");
  });
});

describe("landing page per persona", () => {
  it("sends admins to the admin panel", () => {
    expect(landingPath(["asset_manager"], false)).toBe("/");
  });

  it("sends a maintenance manager to the fleet dashboard", () => {
    expect(landingPath(["maintenance"], false)).toBe("/fleet");
  });

  it("sends a route manager to operations", () => {
    expect(landingPath(["route_manager"], false)).toBe("/operations");
  });

  it("sends an account manager to the accounts dashboard", () => {
    expect(landingPath(["account_manager"], false)).toBe("/accounts");
  });

  it("sends linked crew to their own schedule", () => {
    expect(landingPath(["crew"], true)).toBe("/my-trips");
  });

  it("falls back to the root for an account with neither role nor staff record", () => {
    expect(landingPath([], false)).toBe("/");
  });
});

describe("shared components", () => {
  it("renders a stat card with its label and value", () => {
    render(<StatCard label="Trips" value={42} sub="all time" />);
    expect(screen.getByText("Trips")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("all time")).toBeTruthy();
  });

  it("colours a badge by status", () => {
    render(<Badge value="critical" />);
    const badge = screen.getByText("critical");
    expect(badge.style.background).toBe("rgb(198, 40, 40)");
  });

  it("renders table rows through the column spec", () => {
    render(
      <MemoryRouter>
        <DataTable
          rows={[{ id: "a", n: 1 }]}
          rowKey={(r) => r.id}
          columns={[
            { key: "id", header: "ID", render: (r) => r.id },
            { key: "n", header: "N", render: (r) => r.n },
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("ID")).toBeTruthy();
    expect(screen.getByText("a")).toBeTruthy();
  });

  it("shows the empty message when a table has no rows", () => {
    render(<DataTable rows={[]} rowKey={() => ""} columns={[]} empty="Nothing here" />);
    expect(screen.getByText("Nothing here")).toBeTruthy();
  });

  it("renders one bar per timeline item", () => {
    const { container } = render(
      <Timeline
        items={[
          { id: "w1", label: "a_check", start: "2000-01-01", end: "2000-01-03" },
          { id: "w2", label: "b_check", start: "2000-02-01", end: null },
        ]}
      />,
    );
    expect(screen.getByText("a_check")).toBeTruthy();
    expect(container.querySelectorAll("div[title]").length).toBe(2);
  });
});

describe("detail tabs", () => {
  const tabs = [
    { key: "overview", label: "Overview", render: () => <div>overview body</div> },
    { key: "history", label: "History", badge: 3, render: () => <div>history body</div> },
  ];

  it("renders the first tab by default", () => {
    render(<DetailTabs tabs={tabs} />);
    expect(screen.getByText("overview body")).toBeTruthy();
    expect(screen.queryByText("history body")).toBeNull();
  });

  it("switches the panel when another tab is selected", () => {
    render(<DetailTabs tabs={tabs} />);
    fireEvent.click(screen.getByRole("tab", { name: /History/ }));
    expect(screen.getByText("history body")).toBeTruthy();
    expect(screen.queryByText("overview body")).toBeNull();
  });

  it("shows a count beside a tab that supplies one", () => {
    render(<DetailTabs tabs={tabs} />);
    expect(screen.getByRole("tab", { name: /History 3/ })).toBeTruthy();
  });
});

describe("chart wrappers", () => {
  it("renders a line chart container for trend data", () => {
    const { container } = render(
      <div style={{ width: 400, height: 200 }}>
        <LineTrend
          data={[{ month: "2000-01", trips: 3 }]}
          xKey="month"
          series={[{ key: "trips", label: "Trips" }]}
        />
      </div>,
    );
    expect(container.querySelector(".recharts-responsive-container")).not.toBeNull();
  });

  it("renders a donut container for breakdown data", () => {
    const { container } = render(
      <div style={{ width: 400, height: 200 }}>
        <DonutBreakdown data={[{ name: "active", value: 5 }]} />
      </div>,
    );
    expect(container.querySelector(".recharts-responsive-container")).not.toBeNull();
  });
});
