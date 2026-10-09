import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "./AppLayout.js";
import { LoginView } from "./views/LoginView.js";
import { CallbackView } from "./views/CallbackView.js";
import { VehiclesView } from "./views/VehiclesView.js";
import { OperatorsView } from "./views/OperatorsView.js";
import { OrdersView } from "./views/OrdersView.js";
import { CargoView } from "./views/CargoView.js";
import { RoutesView } from "./views/RoutesView.js";
import { StaffView } from "./views/StaffView.js";
import { CustomersView } from "./views/CustomersView.js";
import { PassengersView } from "./views/PassengersView.js";
import { DashboardView } from "./views/DashboardView.js";
import { FleetView } from "./views/fleet/FleetView.js";
import { VehicleDetailPage } from "./views/fleet/VehicleDetailPage.js";
import { MaintenanceDetailPage } from "./views/fleet/MaintenanceDetailPage.js";
import { OperationsView } from "./views/operations/OperationsView.js";
import { RouteDetailPage } from "./views/operations/RouteDetailPage.js";
import { TripDetailPage } from "./views/operations/TripDetailPage.js";
import { MyTripsView } from "./views/crew/MyTripsView.js";
import { StaffDetailPage } from "./views/crew/StaffDetailPage.js";
import { isLoggedIn } from "./lib/auth.js";

function ProtectedRoute({ children }: { children: React.ReactNode }): React.ReactElement {
  if (!isLoggedIn()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginView />} />
        <Route path="/callback" element={<CallbackView />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardView />} />
          <Route path="vehicles" element={<VehiclesView />} />
          <Route path="operators" element={<OperatorsView />} />
          <Route path="orders" element={<OrdersView />} />
          <Route path="cargo" element={<CargoView />} />
          <Route path="routes" element={<RoutesView />} />
          <Route path="staff" element={<StaffView />} />
          <Route path="customers" element={<CustomersView />} />
          <Route path="passengers" element={<PassengersView />} />
          <Route path="fleet" element={<FleetView />} />
          <Route path="vehicles/:id" element={<VehicleDetailPage />} />
          <Route path="vehicles/:id/maintenance/:mid" element={<MaintenanceDetailPage />} />
          <Route path="operations" element={<OperationsView />} />
          <Route path="routes/:id" element={<RouteDetailPage />} />
          <Route path="trips/:id" element={<TripDetailPage />} />
          <Route path="my-trips" element={<MyTripsView />} />
          <Route path="staff/:id" element={<StaffDetailPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);