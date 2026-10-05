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
import { DashboardView } from "./views/DashboardView.js";
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
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);