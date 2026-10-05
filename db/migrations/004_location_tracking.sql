-- Location tracking: passenger, cargo journey events, passenger boarding events
-- and current_location projection view.
-- Journal is source of truth; current_location is derived from the latest event.

-- ============================================================================
-- Passenger
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
    status           TEXT NOT NULL CHECK (status IN ('checked_in', 'boarded', 'in_transit', 'arrived', 'disembarked')),
    valid_time       DATE NOT NULL,
    schema_version   INTEGER NOT NULL DEFAULT 1,
    generated_at     DATE NOT NULL
);
CREATE INDEX idx_passenger_operator ON passenger (operator_id);
CREATE INDEX idx_passenger_order ON passenger (order_id);
CREATE INDEX idx_passenger_status ON passenger (status);

-- ============================================================================
-- Cargo journey events (location tracking for cargo)
-- ============================================================================

CREATE TABLE cargo_journey_event (
    event_id       TEXT PRIMARY KEY,
    cargo_id       TEXT NOT NULL REFERENCES cargo (cargo_id),
    event_type     TEXT NOT NULL CHECK (event_type IN (
        'pickup', 'loaded', 'departed', 'arrived', 'warehouse_hold', 'transferred', 'delivered'
    )),
    location_iata  CHAR(3) NOT NULL REFERENCES airport (iata),
    facility_id    TEXT REFERENCES facility (facility_id),
    vehicle_id     TEXT REFERENCES vehicle (vehicle_id),
    sequence       INTEGER NOT NULL,
    valid_time     TIMESTAMPTZ NOT NULL,
    actor_id       TEXT NOT NULL REFERENCES staff (staff_id),
    schema_version INTEGER NOT NULL DEFAULT 1,
    generated_at   DATE NOT NULL,
    UNIQUE (cargo_id, sequence)
);
CREATE INDEX idx_cje_cargo ON cargo_journey_event (cargo_id, sequence);
CREATE INDEX idx_cje_type ON cargo_journey_event (event_type);
CREATE INDEX idx_cje_location ON cargo_journey_event (location_iata);

-- ============================================================================
-- Passenger boarding events (location tracking for passengers)
-- ============================================================================

CREATE TABLE passenger_boarding_event (
    event_id       TEXT PRIMARY KEY,
    passenger_id   TEXT NOT NULL REFERENCES passenger (passenger_id),
    event_type     TEXT NOT NULL CHECK (event_type IN (
        'checked_in', 'boarded', 'departed', 'arrived', 'disembarked'
    )),
    location_iata  CHAR(3) NOT NULL REFERENCES airport (iata),
    vehicle_id     TEXT REFERENCES vehicle (vehicle_id),
    sequence       INTEGER NOT NULL,
    valid_time     TIMESTAMPTZ NOT NULL,
    actor_id       TEXT NOT NULL REFERENCES staff (staff_id),
    schema_version INTEGER NOT NULL DEFAULT 1,
    generated_at   DATE NOT NULL,
    UNIQUE (passenger_id, sequence)
);
CREATE INDEX idx_pbe_passenger ON passenger_boarding_event (passenger_id, sequence);
CREATE INDEX idx_pbe_type ON passenger_boarding_event (event_type);
CREATE INDEX idx_pbe_location ON passenger_boarding_event (location_iata);

-- ============================================================================
-- Current location projection (derived from latest journey/boarding event)
-- ============================================================================

-- Cargo current location: the location_iata of the most recent cargo_journey_event
CREATE VIEW cargo_current_location AS
SELECT DISTINCT ON (c.cargo_id)
    c.cargo_id,
    c.customer_id,
    c.operator_id,
    c.origin_iata,
    c.destination_iata,
    c.status AS cargo_status,
    cje.event_type AS last_event_type,
    cje.location_iata AS current_location_iata,
    cje.facility_id AS current_facility_id,
    cje.vehicle_id AS current_vehicle_id,
    cje.valid_time AS last_event_time,
    cje.sequence AS last_sequence
FROM cargo c
LEFT JOIN cargo_journey_event cje ON cje.cargo_id = c.cargo_id
ORDER BY c.cargo_id, cje.sequence DESC;

-- Passenger current location: the location_iata of the most recent boarding event
CREATE VIEW passenger_current_location AS
SELECT DISTINCT ON (p.passenger_id)
    p.passenger_id,
    p.given_name,
    p.family_name,
    p.passenger_type,
    p.operator_id,
    p.origin_iata,
    p.destination_iata,
    p.status AS passenger_status,
    pbe.event_type AS last_event_type,
    pbe.location_iata AS current_location_iata,
    pbe.vehicle_id AS current_vehicle_id,
    pbe.valid_time AS last_event_time,
    pbe.sequence AS last_sequence
FROM passenger p
LEFT JOIN passenger_boarding_event pbe ON pbe.passenger_id = p.passenger_id
ORDER BY p.passenger_id, pbe.sequence DESC;

-- ============================================================================
-- Grants
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON passenger, cargo_journey_event, passenger_boarding_event TO assetic_app;
GRANT SELECT ON cargo_current_location, passenger_current_location TO assetic_app;