import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "./AppLayout.js";
import { LoginView } from "./views/LoginView.js";
import { CallbackView } from "./views/CallbackView.js";
import { AdminPanelView } from "./views/AdminPanelView.js";
import { EntityListPage } from "./views/EntityListPage.js";
import { EntityEditPage } from "./views/EntityEditPage.js";
import { FleetView } from "./views/fleet/FleetView.js";
import { VehicleDetailPage } from "./views/fleet/VehicleDetailPage.js";
import { MaintenanceDetailPage } from "./views/fleet/MaintenanceDetailPage.js";
import { AirportDetailPage } from "./views/fleet/AirportDetailPage.js";
import { AccountsView } from "./views/accounts/AccountsView.js";
import { OperationsView } from "./views/operations/OperationsView.js";
import { RouteDetailPage } from "./views/operations/RouteDetailPage.js";
import { TripDetailPage } from "./views/operations/TripDetailPage.js";
import { MyTripsView } from "./views/crew/MyTripsView.js";
import { StaffDetailPage } from "./views/crew/StaffDetailPage.js";
import { OperatorDetailPage } from "./views/domain/OperatorDetailPage.js";
import { CustomerDetailPage } from "./views/domain/CustomerDetailPage.js";
import { OrderDetailPage } from "./views/domain/OrderDetailPage.js";
import { CargoDetailPage } from "./views/domain/CargoDetailPage.js";
import { PassengerDetailPage } from "./views/domain/PassengerDetailPage.js";
import { ReferenceDetailPage } from "./views/ReferenceDetailPage.js";
import { ENTITIES } from "./lib/entities.jsx";
import { isLoggedIn } from "./lib/auth.js";

function ProtectedRoute({ children }: { children: React.ReactNode }): React.ReactElement {
  if (!isLoggedIn()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/**
 * Entities whose detail view is a bespoke dashboard. Everything else falls
 * back to ReferenceDetailPage, which renders the registry's summary view as a
 * standalone page; both are tabbed shells, so per-entity views can be added
 * as further tabs without touching routing.
 */
const CUSTOM_DETAIL: Record<string, React.ReactElement> = {
  "/airports": <AirportDetailPage />,
  "/operators": <OperatorDetailPage />,
  "/vehicles": <VehicleDetailPage />,
  "/routes": <RouteDetailPage />,
  "/trips": <TripDetailPage />,
  "/staff": <StaffDetailPage />,
  "/customers": <CustomerDetailPage />,
  "/orders": <OrderDetailPage />,
  "/cargo": <CargoDetailPage />,
  "/passengers": <PassengerDetailPage />,
};

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
          <Route index element={<AdminPanelView />} />

          {/* One list route per registered entity, all the same component. */}
          {ENTITIES.map((e) => (
            <Route key={e.key} path={e.path.slice(1)} element={<EntityListPage />} />
          ))}

          {/* Edit routes: generic form per entity, from the registry. */}
          {ENTITIES.map((e) => (
            <Route
              key={`${e.key}-edit`}
              path={`${e.path.slice(1)}/:id/edit`}
              element={<EntityEditPage />}
            />
          ))}

          {/* Detail routes: bespoke dashboard where one exists, else generic. */}
          {ENTITIES.map((e) => (
            <Route
              key={`${e.key}-detail`}
              path={`${e.path.slice(1)}/:id`}
              element={CUSTOM_DETAIL[e.path] ?? <ReferenceDetailPage />}
            />
          ))}

          <Route path="vehicles/:id/maintenance/:mid" element={<MaintenanceDetailPage />} />
          <Route path="fleet" element={<FleetView />} />
          <Route path="accounts" element={<AccountsView />} />
          <Route path="operations" element={<OperationsView />} />
          <Route path="my-trips" element={<MyTripsView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
