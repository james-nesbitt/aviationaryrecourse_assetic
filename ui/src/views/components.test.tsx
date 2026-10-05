import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Mock the auth module
vi.mock("../lib/auth.js", () => ({
  login: vi.fn(),
  isLoggedIn: vi.fn(() => false),
  getUser: vi.fn(() => null),
  getToken: vi.fn(() => null),
  apiFetch: vi.fn(),
  logout: vi.fn(),
}));

import { LoginView } from "../views/LoginView.js";
import { RoutesView } from "../views/RoutesView.js";
import { apiFetch } from "../lib/auth.js";

describe("LoginView", () => {
  it("renders the assetic title and sign-in button", () => {
    render(
      <MemoryRouter>
        <LoginView />
      </MemoryRouter>,
    );
    expect(screen.getByText("assetic")).toBeTruthy();
    expect(screen.getByText("Sign in with Keycloak")).toBeTruthy();
  });

  it("calls login when button is clicked", async () => {
    const { login } = await import("../lib/auth.js");
    render(
      <MemoryRouter>
        <LoginView />
      </MemoryRouter>,
    );
    const button = screen.getByText("Sign in with Keycloak");
    fireEvent.click(button);
    await waitFor(() => {
      expect(vi.mocked(login)).toHaveBeenCalled();
    });
  });
});

describe("RoutesView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading state initially", () => {
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {})); // never resolves
    render(
      <MemoryRouter>
        <RoutesView />
      </MemoryRouter>,
    );
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("renders routes table after data loads", async () => {
    const mockRoutes = [
      {
        route_id: "rte-0001",
        operator_id: "opr-0001",
        vehicle_id: "veh-0001",
        route_type: "passenger",
        base_iata: "LAX",
        legs: [
          { sequence: 1, from_iata: "LAX", to_iata: "DEN", scheduled_departure: "2000-02-16T10:00:00", scheduled_arrival: "2000-02-16T12:13:00" },
        ],
        operator: { name: "Test Air" },
      },
    ];
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockRoutes),
    } as Response);

    render(
      <MemoryRouter>
        <RoutesView />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Routes (1)")).toBeTruthy();
      expect(screen.getByText("rte-0001")).toBeTruthy();
      expect(screen.getByText("Test Air")).toBeTruthy();
    });
  });

  it("expands only the clicked row, not all rows", async () => {
    const mockRoutes = [
      {
        route_id: "rte-0001",
        operator_id: "opr-0001",
        vehicle_id: "veh-0001",
        route_type: "passenger",
        base_iata: "LAX",
        legs: [{ sequence: 1, from_iata: "LAX", to_iata: "DEN", scheduled_departure: "2000-02-16T10:00:00", scheduled_arrival: "2000-02-16T12:13:00" }],
        operator: { name: "Test Air" },
      },
      {
        route_id: "rte-0002",
        operator_id: "opr-0002",
        vehicle_id: "veh-0002",
        route_type: "cargo",
        base_iata: "DFW",
        legs: [{ sequence: 1, from_iata: "DFW", to_iata: "BOS", scheduled_departure: "2000-02-23T08:30:00", scheduled_arrival: "2000-02-23T12:08:00" }],
        operator: { name: "Cargo Co" },
      },
    ];
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockRoutes),
    } as Response);

    render(
      <MemoryRouter>
        <RoutesView />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("rte-0001")).toBeTruthy());

    // Click first row to expand
    const row1 = screen.getByText("rte-0001").closest("tr");
    expect(row1).not.toBeNull();
    fireEvent.click(row1!);

    // First row should show expanded content (LAX leg)
    await waitFor(() => {
      expect(screen.getByText("2000-02-16T12:13:00")).toBeTruthy();
    });

    // Second row should NOT be expanded — its leg time should not appear
    // rte-0002's leg has arrival 2000-02-23T12:08:00
    expect(screen.queryByText("2000-02-23T12:08:00")).toBeNull();
  });

  it("clicking expanded row again collapses it", async () => {
    const mockRoutes = [
      {
        route_id: "rte-0001",
        operator_id: "opr-0001",
        vehicle_id: "veh-0001",
        route_type: "passenger",
        base_iata: "LAX",
        legs: [{ sequence: 1, from_iata: "LAX", to_iata: "DEN", scheduled_departure: "10:00:00", scheduled_arrival: "12:13:00" }],
        operator: { name: "Test Air" },
      },
    ];
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockRoutes),
    } as Response);

    render(
      <MemoryRouter>
        <RoutesView />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("rte-0001")).toBeTruthy());

    const row = screen.getByText("rte-0001").closest("tr");
    expect(row).not.toBeNull();

    // Expand
    fireEvent.click(row!);
    await waitFor(() => expect(screen.getByText("12:13:00")).toBeTruthy());

    // Collapse
    fireEvent.click(row!);
    await waitFor(() => expect(screen.queryByText("12:13:00")).toBeNull());
  });
});