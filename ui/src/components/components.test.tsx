import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { visibleNavItems } from "../AppLayout.js";
import { Badge, DataTable, StatCard, Timeline } from "./index.jsx";
import { DonutBreakdown, LineTrend } from "../charts/index.jsx";

describe("role-gated navigation", () => {
  it("shows only the maintenance section to a maintenance manager", () => {
    const labels = visibleNavItems(["maintenance"]).map((i) => i.label);
    expect(labels).toContain("Fleet & Maintenance");
    expect(labels).not.toContain("Operations Control");
    expect(labels).not.toContain("My Schedule");
  });

  it("shows only the operations section to a route manager", () => {
    const labels = visibleNavItems(["route_manager"]).map((i) => i.label);
    expect(labels).toContain("Operations Control");
    expect(labels).not.toContain("Fleet & Maintenance");
  });

  it("shows only the schedule section to crew", () => {
    const labels = visibleNavItems(["crew"]).map((i) => i.label);
    expect(labels).toContain("My Schedule");
    expect(labels).not.toContain("Operations Control");
  });

  it("shows every section to a user holding all roles", () => {
    const labels = visibleNavItems(["maintenance", "route_manager", "crew"]).map((i) => i.label);
    expect(labels).toContain("Fleet & Maintenance");
    expect(labels).toContain("Operations Control");
    expect(labels).toContain("My Schedule");
  });

  it("keeps the shared domain lists visible without any role", () => {
    const labels = visibleNavItems([]).map((i) => i.label);
    expect(labels).toContain("Vehicles");
    expect(labels).toContain("Dashboard");
    expect(labels).not.toContain("Fleet & Maintenance");
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
