import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../../lib/api.js";
import { Badge, DataTable, Section, StatCard } from "../../components/index.jsx";
import { LineTrend } from "../../charts/index.jsx";
import { formatDate } from "../../lib/format.js";

interface CustomerRow {
  customer_id: string;
  customer_type: string;
  company_name: string;
  operator_id: string;
  contract_start: string;
  monthly_volume_kg: number | null;
}
interface MonthRow {
  month: string;
  orders?: number;
  shipments?: number;
  weight_kg?: number;
}
interface OpenOrderRow {
  order_id: string;
  customer_id: string;
  order_type: string;
  status: string;
  origin_iata: string;
  destination_iata: string;
  ordered_on: string;
}
interface ShipmentRow {
  cargo_id: string;
  customer_id: string;
  customer_name: string;
  state: string;
  current_location_iata: string | null;
  destination_iata: string;
  weight_kg: number;
}
interface AccountsOverview {
  manager: { staff_id: string; name: string } | null;
  customers: CustomerRow[];
  orders_by_month: MonthRow[];
  cargo_by_month: MonthRow[];
  open_orders: OpenOrderRow[];
  active_shipments: ShipmentRow[];
}

/**
 * Account-manager dashboard: the customers under management, their order and
 * shipment volume over time, and the shipments currently in flight. An
 * unlinked administrator sees every customer; a linked account manager sees
 * only their own.
 */
export function AccountsView(): React.ReactElement {
  const [data, setData] = useState<AccountsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<AccountsOverview>("/api/accounts/overview")
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;
  if (!data) return <div>Loading…</div>;

  const totalVolume = data.customers.reduce(
    (n, c) => n + (c.monthly_volume_kg ?? 0),
    0,
  );

  return (
    <div>
      <h1>
        Accounts{data.manager ? ` · ${data.manager.name}` : ""}
      </h1>
      <div style={{ color: "#666", marginBottom: 16 }}>
        {data.manager
          ? "Customers assigned to you and their activity."
          : "All customers (administrator view; a linked account manager sees only their own)."}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard label="Customers" value={data.customers.length} />
        <StatCard label="Open orders" value={data.open_orders.length} />
        <StatCard label="Shipments in flight" value={data.active_shipments.length} />
        <StatCard label="Monthly volume" value={`${totalVolume.toLocaleString()} kg`} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <Section title="Orders per month">
          <LineTrend
            data={data.orders_by_month as unknown as Record<string, unknown>[]}
            xKey="month"
            series={[{ key: "orders", label: "Orders" }]}
          />
        </Section>
        <Section title="Shipment volume per month">
          <LineTrend
            data={data.cargo_by_month as unknown as Record<string, unknown>[]}
            xKey="month"
            series={[
              { key: "shipments", label: "Shipments" },
              { key: "weight_kg", label: "Weight (kg)" },
            ]}
          />
        </Section>
      </div>

      <Section title="Customers">
        <DataTable
          rows={data.customers}
          rowKey={(c) => c.customer_id}
          columns={[
            {
              key: "name",
              header: "Company",
              render: (c) => <Link to={`/customers/${c.customer_id}`}>{c.company_name}</Link>,
            },
            { key: "type", header: "Type", render: (c) => c.customer_type },
            {
              key: "op",
              header: "Operator",
              render: (c) => <Link to={`/operators/${c.operator_id}`}>{c.operator_id}</Link>,
            },
            { key: "since", header: "Contract since", render: (c) => formatDate(c.contract_start) },
            {
              key: "vol",
              header: "Monthly volume",
              render: (c) => (c.monthly_volume_kg ? `${c.monthly_volume_kg.toLocaleString()} kg` : "—"),
            },
          ]}
        />
      </Section>

      <Section title="Open orders">
        <DataTable
          rows={data.open_orders}
          rowKey={(o) => o.order_id}
          columns={[
            {
              key: "order",
              header: "Order",
              render: (o) => <Link to={`/orders/${o.order_id}`}>{o.order_id}</Link>,
            },
            {
              key: "customer",
              header: "Customer",
              render: (o) => <Link to={`/customers/${o.customer_id}`}>{o.customer_id}</Link>,
            },
            { key: "type", header: "Type", render: (o) => o.order_type },
            {
              key: "route",
              header: "Route",
              render: (o) => `${o.origin_iata} → ${o.destination_iata}`,
            },
            { key: "status", header: "Status", render: (o) => <Badge value={o.status} /> },
          ]}
          empty="No open orders"
        />
      </Section>

      <Section title="Shipments in flight">
        <DataTable
          rows={data.active_shipments}
          rowKey={(s) => s.cargo_id}
          columns={[
            {
              key: "shipment",
              header: "Shipment",
              render: (s) => <Link to={`/cargo/${s.cargo_id}`}>{s.cargo_id}</Link>,
            },
            {
              key: "customer",
              header: "Customer",
              render: (s) => (
                <Link to={`/customers/${s.customer_id}`}>{s.customer_name}</Link>
              ),
            },
            { key: "at", header: "Currently at", render: (s) => s.current_location_iata ?? "—" },
            { key: "to", header: "Destination", render: (s) => s.destination_iata },
            { key: "kg", header: "Weight", render: (s) => `${s.weight_kg} kg` },
            { key: "state", header: "State", render: (s) => <Badge value={s.state} /> },
          ]}
          empty="No shipments in flight"
        />
      </Section>
    </div>
  );
}