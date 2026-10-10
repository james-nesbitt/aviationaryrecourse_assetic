import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiDelete, apiGet } from "../../lib/api.js";
import { canWrite } from "../../lib/permissions.js";
import { Badge, DataTable, DetailHeader, DetailTabs, FieldGrid, Section, StatCard } from "../../components/index.jsx";
import { formatDate } from "../../lib/format.js";

interface OrderRow {
  order_id: string;
  order_type: string;
  origin_iata: string;
  destination_iata: string;
  status: string;
  ordered_on: string;
}
interface CargoRow {
  cargo_id: string;
  origin_iata: string;
  destination_iata: string;
  weight_kg: number;
  state: string;
}
interface CustomerDetail {
  customer_id: string;
  customer_type: string;
  company_name: string;
  operator_id: string;
  account_manager_id: string | null;
  contract_start: string;
  monthly_volume_kg: number | null;
  orders: OrderRow[];
  cargo: CargoRow[];
}

/** Customer dashboard: contract terms, orders placed and shipments carried. */
export function CustomerDetailPage(): React.ReactElement {
  const { id = "" } = useParams();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<CustomerDetail>(`/api/customers/${id}`)
      .then(setCustomer)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    apiGet<{ roles?: string[] }>("/api/me")
      .then((me) => setRoles(me.roles ?? []))
      .catch(() => setRoles([]));
  }, []);

  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;
  if (!customer) return <div>Loading…</div>;

  return (
    <div>
      <DetailHeader
        title={customer.company_name}
        subtitle={`${customer.customer_type} · ${customer.operator_id}`}
        backTo="/customers"
        backLabel="Customers"
        editTo={canWrite(roles, "customers", "update") ? `/customers/${id}/edit` : undefined}
        onDelete={
          canWrite(roles, "customers", "delete")
            ? () => {
                void apiDelete(`/api/customers/${id}`).then(() => navigate("/customers"));
              }
            : undefined
        }
      />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard label="Orders" value={customer.orders.length} />
        <StatCard label="Shipments" value={customer.cargo.length} />
        <StatCard
          label="Monthly volume"
          value={customer.monthly_volume_kg ? `${customer.monthly_volume_kg} kg` : "—"}
        />
      </div>

      <DetailTabs
        tabs={[
          { key: "overview", label: "Contract", render: () => (<>
      <Section title="Contract">
        <FieldGrid
          fields={[
            { label: "Customer id", value: customer.customer_id },
            { label: "Type", value: customer.customer_type },
            {
              label: "Operator",
              value: <Link to={`/operators/${customer.operator_id}`}>{customer.operator_id}</Link>,
            },
            {
              label: "Account manager",
              value: customer.account_manager_id ? (
                <Link to={`/staff/${customer.account_manager_id}`}>{customer.account_manager_id}</Link>
              ) : (
                "—"
              ),
            },
            { label: "Contract start", value: formatDate(customer.contract_start) },
          ]}
        />
      </Section>

          </>) },
          { key: "orders", label: "Orders", badge: customer.orders.length, render: () => (<>
      <Section title="Orders">
        <DataTable
          rows={customer.orders}
          rowKey={(o) => o.order_id}
          columns={[
            { key: "id", header: "Order", render: (o) => <Link to={`/orders/${o.order_id}`}>{o.order_id}</Link> },
            { key: "type", header: "Type", render: (o) => o.order_type },
            { key: "route", header: "Route", render: (o) => `${o.origin_iata} → ${o.destination_iata}` },
            { key: "on", header: "Ordered", render: (o) => formatDate(o.ordered_on) },
            { key: "status", header: "Status", render: (o) => <Badge value={o.status} /> },
          ]}
          empty="No orders"
        />
      </Section>

          </>) },
          { key: "cargo", label: "Shipments", badge: customer.cargo.length, render: () => (<>
      <Section title="Shipments">
        <DataTable
          rows={customer.cargo.slice(0, 25)}
          rowKey={(c) => c.cargo_id}
          columns={[
            { key: "id", header: "Shipment", render: (c) => <Link to={`/cargo/${c.cargo_id}`}>{c.cargo_id}</Link> },
            { key: "route", header: "Route", render: (c) => `${c.origin_iata} → ${c.destination_iata}` },
            { key: "kg", header: "Weight", render: (c) => `${c.weight_kg} kg` },
            { key: "state", header: "State", render: (c) => <Badge value={c.state} /> },
          ]}
          empty="No shipments"
        />
      </Section>
          </>) },
        ]}
      />
    </div>
  );
}
