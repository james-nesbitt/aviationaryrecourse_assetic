-- assetic POC schema — full spec domain model matching tools/datagen JSONL output
-- Run as the first migration. All entities use TEXT natural keys matching datagen IDs.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- Reference data
-- ============================================================================

CREATE TABLE airport (
    iata          CHAR(3) PRIMARY KEY,
    icao          TEXT NOT NULL,
    name          TEXT NOT NULL,
    city          TEXT NOT NULL,
    country       TEXT NOT NULL,
    country_code  CHAR(2) NOT NULL,
    latitude      DOUBLE PRECISION NOT NULL,
    longitude     DOUBLE PRECISION NOT NULL,
    elevation_ft  INTEGER NOT NULL,
    timezone      TEXT NOT NULL
);

CREATE TABLE aircraft_model (
    model_id              TEXT PRIMARY KEY,
    manufacturer          TEXT NOT NULL,
    family                TEXT NOT NULL,
    icao_type             TEXT NOT NULL,
    name                  TEXT NOT NULL,
    pax_capacity_typical  INTEGER NOT NULL,
    cargo_capacity_kg     INTEGER NOT NULL,
    range_km              INTEGER NOT NULL,
    engine_count          INTEGER NOT NULL,
    category              TEXT NOT NULL CHECK (category IN (
        'narrowbody', 'widebody', 'widebody_freighter',
        'regional', 'regional_turboprop'
    ))
);

-- ============================================================================
-- Core entities
-- ============================================================================

CREATE TABLE operator (
    operator_id      TEXT PRIMARY KEY,
    name             TEXT NOT NULL UNIQUE,
    type             TEXT NOT NULL CHECK (type IN ('passenger', 'cargo', 'military')),
    country          TEXT NOT NULL,
    hub_iata         CHAR(3) NOT NULL REFERENCES airport (iata),
    founded_year     INTEGER NOT NULL CHECK (founded_year BETWEEN 1900 AND 2100),
    fleet_size_hint  INTEGER NOT NULL,
    schema_version   INTEGER NOT NULL DEFAULT 1,
    generated_at     DATE NOT NULL
);

CREATE TABLE vehicle (
    vehicle_id      TEXT PRIMARY KEY,
    kind            TEXT NOT NULL CHECK (kind IN ('aircraft', 'ground_support', 'rail')),
    operator_id     TEXT NOT NULL REFERENCES operator (operator_id),
    -- aircraft fields (nullable for non-aircraft)
    registration    TEXT,
    model_id        TEXT REFERENCES aircraft_model (model_id),
    status          TEXT CHECK (status IN ('active', 'maintenance', 'stored')),
    seat_config     JSONB,
    -- ground_support / rail fields
    gse_type        TEXT,
    rail_type       TEXT,
    -- shared base location
    base_iata       CHAR(3) REFERENCES airport (iata),
    home_iata       CHAR(3) REFERENCES airport (iata),
    schema_version  INTEGER NOT NULL DEFAULT 1,
    generated_at    DATE NOT NULL,
    CHECK (
        (kind = 'aircraft' AND registration IS NOT NULL) OR
        (kind = 'ground_support' AND gse_type IS NOT NULL) OR
        (kind = 'rail' AND rail_type IS NOT NULL)
    )
);
CREATE INDEX idx_vehicle_operator ON vehicle (operator_id);
CREATE INDEX idx_vehicle_kind ON vehicle (kind);

CREATE TABLE ownership_history (
    vehicle_id        TEXT NOT NULL REFERENCES vehicle (vehicle_id),
    sequence          INTEGER NOT NULL,
    from_operator_id  TEXT NOT NULL REFERENCES operator (operator_id),
    to_operator_id    TEXT NOT NULL REFERENCES operator (operator_id),
    transfer_type     TEXT NOT NULL CHECK (transfer_type IN ('lease_start', 'purchase')),
    valid_time        DATE NOT NULL,
    PRIMARY KEY (vehicle_id, sequence)
);

CREATE TABLE staff (
    staff_id        TEXT PRIMARY KEY,
    given_name      TEXT NOT NULL,
    family_name     TEXT NOT NULL,
    role_class      TEXT NOT NULL CHECK (role_class IN ('flight_crew', 'ground_crew', 'management')),
    role            TEXT NOT NULL,
    operator_id     TEXT NOT NULL REFERENCES operator (operator_id),
    base_iata       CHAR(3) NOT NULL REFERENCES airport (iata),
    hire_date       DATE NOT NULL,
    certifications  JSONB NOT NULL DEFAULT '[]',
    schema_version  INTEGER NOT NULL DEFAULT 1,
    generated_at    DATE NOT NULL
);
CREATE INDEX idx_staff_operator ON staff (operator_id);
CREATE INDEX idx_staff_role ON staff (role);

CREATE TABLE facility (
    facility_id     TEXT PRIMARY KEY,
    facility_type   TEXT NOT NULL CHECK (facility_type IN ('hangar', 'warehouse')),
    operator_id     TEXT NOT NULL REFERENCES operator (operator_id),
    airport_iata    CHAR(3) NOT NULL REFERENCES airport (iata),
    capacity_units  INTEGER NOT NULL,
    schema_version  INTEGER NOT NULL DEFAULT 1,
    generated_at    DATE NOT NULL
);
CREATE INDEX idx_facility_operator ON facility (operator_id);

CREATE TABLE carrier_customer (
    customer_id         TEXT PRIMARY KEY,
    customer_type       TEXT NOT NULL CHECK (customer_type IN ('cargo_shipper', 'charter')),
    company_name        TEXT NOT NULL,
    operator_id         TEXT NOT NULL REFERENCES operator (operator_id),
    account_manager_id  TEXT REFERENCES staff (staff_id),
    contract_start      DATE NOT NULL,
    monthly_volume_kg   INTEGER,
    schema_version      INTEGER NOT NULL DEFAULT 1,
    generated_at        DATE NOT NULL,
    CHECK (
        (customer_type = 'cargo_shipper' AND monthly_volume_kg IS NOT NULL) OR
        (customer_type = 'charter' AND monthly_volume_kg IS NULL)
    )
);
CREATE INDEX idx_customer_operator ON carrier_customer (operator_id);

CREATE TABLE cargo (
    cargo_id            TEXT PRIMARY KEY,
    customer_id         TEXT NOT NULL REFERENCES carrier_customer (customer_id),
    operator_id         TEXT NOT NULL REFERENCES operator (operator_id),
    origin_iata         CHAR(3) NOT NULL REFERENCES airport (iata),
    destination_iata    CHAR(3) NOT NULL REFERENCES airport (iata),
    assigned_vehicle_id TEXT REFERENCES vehicle (vehicle_id),
    weight_kg           INTEGER NOT NULL,
    cargo_type          TEXT NOT NULL CHECK (cargo_type IN ('general', 'perishable', 'pharma', 'hazmat', 'oversize')),
    status              TEXT NOT NULL CHECK (status IN ('scheduled', 'loaded', 'in_transit', 'delivered')),
    valid_time          DATE NOT NULL,
    schema_version      INTEGER NOT NULL DEFAULT 1,
    generated_at        DATE NOT NULL
);
CREATE INDEX idx_cargo_customer ON cargo (customer_id);
CREATE INDEX idx_cargo_operator ON cargo (operator_id);
CREATE INDEX idx_cargo_status ON cargo (status);

CREATE TABLE route (
    route_id        TEXT PRIMARY KEY,
    operator_id     TEXT NOT NULL REFERENCES operator (operator_id),
    vehicle_id      TEXT NOT NULL REFERENCES vehicle (vehicle_id),
    route_type      TEXT NOT NULL CHECK (route_type IN ('passenger', 'cargo', 'military')),
    base_iata       CHAR(3) NOT NULL REFERENCES airport (iata),
    legs            JSONB NOT NULL,
    schema_version  INTEGER NOT NULL DEFAULT 1,
    generated_at    DATE NOT NULL
);
CREATE INDEX idx_route_operator ON route (operator_id);
CREATE INDEX idx_route_vehicle ON route (vehicle_id);

CREATE TABLE assetic_order (
    order_id            TEXT PRIMARY KEY,
    customer_id         TEXT NOT NULL REFERENCES carrier_customer (customer_id),
    operator_id         TEXT NOT NULL REFERENCES operator (operator_id),
    order_type          TEXT NOT NULL CHECK (order_type IN ('charter_passenger', 'cargo')),
    account_manager_id  TEXT REFERENCES staff (staff_id),
    trip_manager_id     TEXT REFERENCES staff (staff_id),
    origin_iata         CHAR(3) NOT NULL REFERENCES airport (iata),
    destination_iata    CHAR(3) NOT NULL REFERENCES airport (iata),
    planned_legs        JSONB NOT NULL,
    transit_route_ids   JSONB NOT NULL DEFAULT '[]',
    ordered_on          DATE NOT NULL,
    status              TEXT NOT NULL CHECK (status IN ('requested', 'confirmed', 'in_progress', 'completed')),
    -- variant payload: passenger_group for charter, freight for cargo
    passenger_group     JSONB,
    freight             JSONB,
    schema_version      INTEGER NOT NULL DEFAULT 1,
    generated_at        DATE NOT NULL,
    CHECK (
        (order_type = 'charter_passenger' AND passenger_group IS NOT NULL) OR
        (order_type = 'cargo' AND freight IS NOT NULL)
    )
);
CREATE INDEX idx_order_customer ON assetic_order (customer_id);
CREATE INDEX idx_order_operator ON assetic_order (operator_id);
CREATE INDEX idx_order_status ON assetic_order (status);

-- ============================================================================
-- Append-only hash-chained bitemporal journal
-- Spec: journal is source of truth; state is derivable; journal wins on conflict.
-- Hash-chained on custody/approval/payment event types.
-- ============================================================================

CREATE TABLE journal_entry (
    journal_id      BIGSERIAL PRIMARY KEY,
    -- chain key: groups rows into a hash chain (e.g. 'custody:<entity_id>', 'approval:<entity_id>')
    chain_key       TEXT NOT NULL,
    -- event identity
    event_type      TEXT NOT NULL CHECK (event_type IN (
        'custody.accepted', 'custody.transferred',
        'approval.proposed', 'approval.approved', 'approval.rejected',
        'payment.initiated', 'payment.completed',
        'boarding', 'loading', 'departure', 'arrival',
        'dispatch.created', 'dispatch.updated',
        'agent.action'
    )),
    entity_type     TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    -- actor identity (dual: human + optional agent)
    actor_id        TEXT NOT NULL,
    agent_run_id    TEXT,
    -- event payload
    payload         JSONB NOT NULL,
    -- bitemporal: when it happened in the world vs when the system recorded it
    valid_time      TIMESTAMPTZ NOT NULL,
    transaction_time TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- hash chain: row_hash = sha256(chain_key || journal_id || prev_hash || event_type || entity_id || payload::text || valid_time::text)
    prev_hash       TEXT,
    row_hash        TEXT NOT NULL,
    schema_version  INTEGER NOT NULL DEFAULT 1
);

-- INSERT-only: no UPDATE/DELETE grants to the application role.
-- Enforced via GRANT below after role creation in a separate migration or init.

CREATE INDEX idx_journal_chain ON journal_entry (chain_key, journal_id);
CREATE INDEX idx_journal_entity ON journal_entry (entity_type, entity_id);
CREATE INDEX idx_journal_event_type ON journal_entry (event_type);
CREATE INDEX idx_journal_valid_time ON journal_entry (valid_time);

-- ============================================================================
-- Initial GRANT posture (revokes UPDATE/DELETE on journal_entry from PUBLIC)
-- ============================================================================
REVOKE ALL ON journal_entry FROM PUBLIC;
-- The app role (assetic_app) will be granted SELECT + INSERT only on journal_entry
-- by the init script. Full privileges remain with the migration/owner role.