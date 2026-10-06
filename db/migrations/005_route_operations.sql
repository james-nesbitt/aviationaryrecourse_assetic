-- Route operations: recurring routes, dated executions, vehicle assignments
-- and maintenance windows (datagen expansion, schema v005).

-- ============================================================================
-- Route recurrence
-- ============================================================================

ALTER TABLE route ADD COLUMN frequency_days INTEGER NOT NULL CHECK (frequency_days >= 1);
ALTER TABLE route ADD COLUMN first_operating_date DATE NOT NULL;

-- ============================================================================
-- Vehicle maintenance windows
-- ============================================================================

CREATE TABLE vehicle_maintenance (
    maintenance_id   TEXT PRIMARY KEY,
    vehicle_id       TEXT NOT NULL REFERENCES vehicle (vehicle_id),
    facility_id      TEXT REFERENCES facility (facility_id),
    maintenance_type TEXT NOT NULL CHECK (maintenance_type IN ('a_check','b_check','c_check','unscheduled')),
    start_date       DATE NOT NULL,
    end_date         DATE NOT NULL CHECK (end_date >= start_date),
    status           TEXT NOT NULL CHECK (status IN ('scheduled','in_progress','completed')),
    schema_version   INTEGER NOT NULL DEFAULT 1,
    generated_at     DATE NOT NULL
);
CREATE INDEX idx_vehicle_maintenance_vehicle ON vehicle_maintenance (vehicle_id, start_date);

-- ============================================================================
-- Route assignments (which vehicle operates a route over a date interval)
-- ============================================================================

CREATE TABLE route_assignment (
    assignment_id       TEXT PRIMARY KEY,
    route_id            TEXT NOT NULL REFERENCES route (route_id),
    vehicle_id          TEXT NOT NULL REFERENCES vehicle (vehicle_id),
    valid_from          DATE NOT NULL,
    valid_to            DATE,
    reason              TEXT NOT NULL CHECK (reason IN ('initial','swap','maintenance_cover','maintenance_return')),
    replaces_vehicle_id TEXT REFERENCES vehicle (vehicle_id),
    schema_version      INTEGER NOT NULL DEFAULT 1,
    generated_at        DATE NOT NULL,
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX idx_route_assignment_route   ON route_assignment (route_id, valid_from);
CREATE INDEX idx_route_assignment_vehicle ON route_assignment (vehicle_id, valid_from);

-- ============================================================================
-- Route operations (dated executions of recurring routes)
-- ============================================================================

CREATE TABLE route_operation (
    operation_id   TEXT PRIMARY KEY,
    route_id       TEXT NOT NULL REFERENCES route (route_id),
    vehicle_id     TEXT NOT NULL REFERENCES vehicle (vehicle_id),
    operator_id    TEXT NOT NULL REFERENCES operator (operator_id),
    operating_date DATE NOT NULL,
    status         TEXT NOT NULL CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
    legs           JSONB NOT NULL,
    schema_version  INTEGER NOT NULL DEFAULT 1,
    generated_at   DATE NOT NULL,
    UNIQUE (route_id, operating_date)
);
CREATE INDEX idx_route_operation_vehicle  ON route_operation (vehicle_id, operating_date);
CREATE INDEX idx_route_operation_operator ON route_operation (operator_id, operating_date);
CREATE INDEX idx_route_operation_status   ON route_operation (status);

-- ============================================================================
-- Cargo/passenger bookings reference the operation they ride
-- ============================================================================

ALTER TABLE cargo     ADD COLUMN operation_id TEXT REFERENCES route_operation (operation_id);
ALTER TABLE passenger ADD COLUMN operation_id TEXT REFERENCES route_operation (operation_id);
CREATE INDEX idx_cargo_operation     ON cargo (operation_id);
CREATE INDEX idx_passenger_operation ON passenger (operation_id);

-- ============================================================================
-- State projection views (re-created from 004 with the operation_id column)
-- ============================================================================

DROP VIEW cargo_state;
DROP VIEW passenger_state;

CREATE VIEW cargo_state AS
SELECT DISTINCT ON (c.cargo_id)
    c.cargo_id, c.customer_id, cc.company_name AS customer_name,
    c.operator_id, o.name AS operator_name,
    c.origin_iata, c.destination_iata, c.assigned_vehicle_id, c.operation_id,
    c.weight_kg, c.cargo_type, c.valid_time, c.schema_version, c.generated_at,
    COALESCE(te.to_state, 'scheduled') AS state,
    te.event_type AS last_event_type,
    te.location_iata AS current_location_iata,
    te.facility_id AS current_facility_id,
    te.vehicle_id AS current_vehicle_id,
    te.valid_time AS last_event_time,
    te.sequence AS last_sequence
FROM cargo c
JOIN carrier_customer cc ON cc.customer_id = c.customer_id
JOIN operator o ON o.operator_id = c.operator_id
LEFT JOIN transit_event te ON te.cargo_id = c.cargo_id
ORDER BY c.cargo_id, te.sequence DESC NULLS LAST;

CREATE VIEW passenger_state AS
SELECT DISTINCT ON (p.passenger_id)
    p.passenger_id, p.given_name, p.family_name, p.passenger_type, p.order_id,
    p.operation_id,
    p.operator_id, o.name AS operator_name,
    p.origin_iata, p.destination_iata, p.valid_time, p.schema_version, p.generated_at,
    COALESCE(te.to_state, 'booked') AS state,
    te.event_type AS last_event_type,
    te.location_iata AS current_location_iata,
    te.vehicle_id AS current_vehicle_id,
    te.valid_time AS last_event_time,
    te.sequence AS last_sequence
FROM passenger p
JOIN operator o ON o.operator_id = p.operator_id
LEFT JOIN transit_event te ON te.passenger_id = p.passenger_id
ORDER BY p.passenger_id, te.sequence DESC NULLS LAST;

-- ============================================================================
-- Grants (DROP VIEW discards the views' ACLs; re-grant)
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON vehicle_maintenance, route_assignment, route_operation TO assetic_app;
GRANT SELECT ON cargo_state, passenger_state TO assetic_app;