-- Transit event log: unified state-transition tracking for cargo and passengers.
-- transit_event records typed state transitions (from_state -> to_state, named by
-- an event_type verb) for both subjects. Allowed transitions live in the
-- transit_transition lookup table and are enforced by a composite foreign key.
-- Entity state is a projection: cargo_state / passenger_state views expose the
-- latest to_state. The hash-chained journal_entry remains the audit layer.

-- ============================================================================
-- Passenger (status column removed; state is derived from transit_event)
-- ============================================================================

CREATE TABLE passenger (
    passenger_id     TEXT PRIMARY KEY,
    given_name       TEXT NOT NULL,
    family_name      TEXT NOT NULL,
    passenger_type   TEXT NOT NULL CHECK (passenger_type IN ('adult', 'child', 'infant')),
    order_id         TEXT REFERENCES assetic_order (order_id),
    operator_id      TEXT NOT NULL REFERENCES operator (operator_id),
    origin_iata      CHAR(3) NOT NULL REFERENCES airport (iata),
    destination_iata CHAR(3) NOT NULL REFERENCES airport (iata),
    valid_time       DATE NOT NULL,
    schema_version   INTEGER NOT NULL DEFAULT 1,
    generated_at     DATE NOT NULL
);
CREATE INDEX idx_passenger_operator ON passenger (operator_id);
CREATE INDEX idx_passenger_order ON passenger (order_id);

-- ============================================================================
-- Cargo: drop status (defined in 001 with CHECK and idx_cargo_status, which
-- the DROP takes with it; 001 stays untouched)
-- ============================================================================

ALTER TABLE cargo DROP COLUMN status;

-- ============================================================================
-- Transit transition lookup (the state machine)
-- ============================================================================

CREATE TABLE transit_transition (
    subject_type TEXT NOT NULL CHECK (subject_type IN ('cargo', 'passenger')),
    event_type   TEXT NOT NULL,
    from_state   TEXT NOT NULL,
    to_state     TEXT NOT NULL,
    PRIMARY KEY (subject_type, event_type, from_state, to_state)
);

INSERT INTO transit_transition (subject_type, event_type, from_state, to_state) VALUES
    -- cargo
    ('cargo', 'pickup',   'scheduled', 'picked_up'),
    ('cargo', 'load',     'picked_up', 'loaded'),
    ('cargo', 'load',     'arrived',   'loaded'),
    ('cargo', 'load',     'held',      'loaded'),
    ('cargo', 'depart',   'loaded',    'in_transit'),
    ('cargo', 'arrive',   'in_transit', 'arrived'),
    ('cargo', 'hold',     'arrived',  'held'),
    ('cargo', 'deliver',  'arrived',  'delivered'),
    -- passenger
    ('passenger', 'check_in',   'booked',     'checked_in'),
    ('passenger', 'board',      'checked_in', 'boarded'),
    ('passenger', 'depart',     'boarded',    'in_transit'),
    ('passenger', 'arrive',     'in_transit', 'arrived'),
    ('passenger', 'disembark',  'arrived',    'disembarked');

-- ============================================================================
-- Transit event log
-- ============================================================================

CREATE TABLE transit_event (
    event_id       TEXT PRIMARY KEY,
    subject_type   TEXT NOT NULL CHECK (subject_type IN ('cargo', 'passenger')),
    cargo_id       TEXT REFERENCES cargo (cargo_id),
    passenger_id   TEXT REFERENCES passenger (passenger_id),
    sequence       INTEGER NOT NULL CHECK (sequence >= 1),
    event_type     TEXT NOT NULL,
    from_state     TEXT NOT NULL,
    to_state       TEXT NOT NULL,
    location_iata  CHAR(3) NOT NULL REFERENCES airport (iata),
    vehicle_id     TEXT REFERENCES vehicle (vehicle_id),
    facility_id    TEXT REFERENCES facility (facility_id),
    actor_id       TEXT REFERENCES staff (staff_id),
    valid_time     TIMESTAMPTZ NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    generated_at   DATE NOT NULL,
    CHECK ((subject_type = 'cargo'     AND cargo_id IS NOT NULL AND passenger_id IS NULL)
        OR (subject_type = 'passenger' AND passenger_id IS NOT NULL AND cargo_id IS NULL)),
    FOREIGN KEY (subject_type, event_type, from_state, to_state)
        REFERENCES transit_transition (subject_type, event_type, from_state, to_state)
);
CREATE UNIQUE INDEX uq_transit_event_cargo_seq     ON transit_event (cargo_id, sequence) WHERE cargo_id IS NOT NULL;
CREATE UNIQUE INDEX uq_transit_event_passenger_seq ON transit_event (passenger_id, sequence) WHERE passenger_id IS NOT NULL;
CREATE INDEX idx_transit_event_cargo     ON transit_event (cargo_id, sequence DESC);
CREATE INDEX idx_transit_event_passenger ON transit_event (passenger_id, sequence DESC);
CREATE INDEX idx_transit_event_location  ON transit_event (location_iata);
CREATE INDEX idx_transit_event_type      ON transit_event (event_type);

-- ============================================================================
-- State projection views
-- ============================================================================

CREATE VIEW cargo_state AS
SELECT DISTINCT ON (c.cargo_id)
    c.cargo_id, c.customer_id, cc.company_name AS customer_name,
    c.operator_id, o.name AS operator_name,
    c.origin_iata, c.destination_iata, c.assigned_vehicle_id,
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
-- Grants
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON passenger, transit_event TO assetic_app;
GRANT SELECT ON transit_transition, cargo_state, passenger_state TO assetic_app;