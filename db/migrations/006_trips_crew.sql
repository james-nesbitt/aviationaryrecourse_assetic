-- Trips (dated route instances), crew assignments, staff identity link and
-- the derived crew fatigue view (schema v006).
--
-- Renames the route_operation concept from the previous iteration to "trip":
-- a route is the recurring pattern, a trip is one dated execution of it.

-- ============================================================================
-- Trips: dated instances of a route
-- ============================================================================

CREATE TABLE trip (
    trip_id        TEXT PRIMARY KEY,
    route_id       TEXT NOT NULL REFERENCES route (route_id),
    vehicle_id     TEXT NOT NULL REFERENCES vehicle (vehicle_id),
    operator_id    TEXT NOT NULL REFERENCES operator (operator_id),
    operating_date DATE NOT NULL,
    status         TEXT NOT NULL CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
    legs           JSONB NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    generated_at   DATE NOT NULL,
    UNIQUE (route_id, operating_date)
);
CREATE INDEX idx_trip_vehicle  ON trip (vehicle_id, operating_date);
CREATE INDEX idx_trip_operator ON trip (operator_id, operating_date);
CREATE INDEX idx_trip_status   ON trip (status);

-- ============================================================================
-- Cargo/passenger bookings reference the trip they ride
-- ============================================================================

ALTER TABLE cargo     ADD COLUMN trip_id TEXT REFERENCES trip (trip_id);
ALTER TABLE passenger ADD COLUMN trip_id TEXT REFERENCES trip (trip_id);
CREATE INDEX idx_cargo_trip     ON cargo (trip_id);
CREATE INDEX idx_passenger_trip ON passenger (trip_id);

-- ============================================================================
-- Staff identity link (Keycloak user -> staff record, for /api/me)
-- ============================================================================

ALTER TABLE staff ADD COLUMN keycloak_username TEXT UNIQUE;

-- ============================================================================
-- Crew assignments: which crew staffed which trip
-- ============================================================================

CREATE TABLE crew_assignment (
    assignment_id   TEXT PRIMARY KEY,
    trip_id         TEXT NOT NULL REFERENCES trip (trip_id),
    staff_id        TEXT NOT NULL REFERENCES staff (staff_id),
    crew_role       TEXT NOT NULL CHECK (crew_role IN ('captain','first_officer','cabin_lead','cabin_crew')),
    schema_version  INTEGER NOT NULL DEFAULT 1,
    generated_at    DATE NOT NULL,
    UNIQUE (trip_id, staff_id)
);
CREATE INDEX idx_crew_assignment_trip  ON crew_assignment (trip_id);
CREATE INDEX idx_crew_assignment_staff ON crew_assignment (staff_id);

-- ============================================================================
-- Dataset anchor
-- ============================================================================
-- Datagen writes generated_at = anchor on every row it produces. The anchor
-- is read from operator because the API never inserts operators: trips and
-- crew assignments created through route/crew writes carry the server date,
-- which would otherwise drag the anchor to "today" and make every
-- anchor-relative metric read as idle.

CREATE VIEW dataset_anchor_v AS
SELECT max(generated_at) AS anchor_date,
       max(generated_at) + TIME '12:00' AS anchor_at
FROM operator;

-- ============================================================================
-- Crew fatigue: derived, never stored
-- ============================================================================
-- Metrics per staff member, relative to the dataset anchor (see above); the
-- anchor instant is that date at 12:00, matching
-- assetic_datagen.rng.anchor_instant.
--
--   duty_hours_7d          sum over trips in the trailing 7 days of
--                          (last arrival - first departure) + 2h pre/post
--   consecutive_duty_days  length of the unbroken run of duty days ending
--                          on the anchor date (0 when idle on that date)
--   rest_since_last_hours  anchor instant - last completed trip arrival
--
-- Thresholds (keep in sync with api/src/lib/fatigue.ts FATIGUE_THRESHOLDS):
--   warn:     >40h duty, >5 consecutive days, or <12h rest
--   critical: >55h duty, >6 consecutive days, or <10h rest

CREATE VIEW crew_fatigue_v AS
WITH anchor AS (
    SELECT anchor_date, anchor_at FROM dataset_anchor_v
),
duty AS (
    SELECT ca.staff_id,
           t.operating_date,
           (t.legs -> 0 ->> 'scheduled_departure')::timestamp AS dep,
           (t.legs -> (jsonb_array_length(t.legs) - 1) ->> 'scheduled_arrival')::timestamp AS arr
    FROM crew_assignment ca
    JOIN trip t ON t.trip_id = ca.trip_id
),
past AS (
    SELECT d.* FROM duty d, anchor a WHERE d.arr <= a.anchor_at
),
week AS (
    SELECT p.staff_id,
           sum(extract(epoch FROM (p.arr - p.dep)) / 3600.0 + 2) AS duty_hours_7d
    FROM past p, anchor a
    WHERE p.operating_date BETWEEN a.anchor_date - 7 AND a.anchor_date
    GROUP BY p.staff_id
),
duty_days AS (
    SELECT DISTINCT staff_id, operating_date FROM past
),
islands AS (
    SELECT staff_id, operating_date,
           operating_date - (ROW_NUMBER() OVER (PARTITION BY staff_id ORDER BY operating_date))::int AS grp
    FROM duty_days
),
runs AS (
    SELECT staff_id, grp, count(*) AS run_len, max(operating_date) AS last_day
    FROM islands GROUP BY staff_id, grp
),
current_run AS (
    SELECT r.staff_id, r.run_len AS consecutive_duty_days
    FROM runs r, anchor a
    WHERE r.last_day = a.anchor_date
),
rest AS (
    SELECT p.staff_id,
           extract(epoch FROM (a.anchor_at - max(p.arr))) / 3600.0 AS rest_since_last_hours
    FROM past p, anchor a
    GROUP BY p.staff_id, a.anchor_at
)
SELECT s.staff_id,
       s.given_name,
       s.family_name,
       s.role,
       s.role_class,
       s.operator_id,
       s.keycloak_username,
       round(COALESCE(w.duty_hours_7d, 0)::numeric, 2)::float8  AS duty_hours_7d,
       COALESCE(cr.consecutive_duty_days, 0)::int       AS consecutive_duty_days,
       round(r.rest_since_last_hours::numeric, 2)::float8       AS rest_since_last_hours,
       CASE
           WHEN COALESCE(w.duty_hours_7d, 0) > 55
             OR COALESCE(cr.consecutive_duty_days, 0) > 6
             OR (r.rest_since_last_hours IS NOT NULL AND r.rest_since_last_hours < 10)
               THEN 'critical'
           WHEN COALESCE(w.duty_hours_7d, 0) > 40
             OR COALESCE(cr.consecutive_duty_days, 0) > 5
             OR (r.rest_since_last_hours IS NOT NULL AND r.rest_since_last_hours < 12)
               THEN 'warn'
           ELSE 'ok'
       END AS level
FROM staff s
LEFT JOIN week w         ON w.staff_id = s.staff_id
LEFT JOIN current_run cr ON cr.staff_id = s.staff_id
LEFT JOIN rest r         ON r.staff_id = s.staff_id
WHERE s.role_class = 'flight_crew';

-- ============================================================================
-- State projection views (re-created from 004 with the trip_id column)
-- ============================================================================

DROP VIEW cargo_state;
DROP VIEW passenger_state;

CREATE VIEW cargo_state AS
SELECT DISTINCT ON (c.cargo_id)
    c.cargo_id, c.customer_id, cc.company_name AS customer_name,
    c.operator_id, o.name AS operator_name,
    c.origin_iata, c.destination_iata, c.assigned_vehicle_id, c.trip_id,
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
    p.trip_id,
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

GRANT SELECT, INSERT, UPDATE, DELETE ON trip, crew_assignment TO assetic_app;
GRANT SELECT ON crew_fatigue_v, dataset_anchor_v, cargo_state, passenger_state TO assetic_app;