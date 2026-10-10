-- Route recurrence: recurring route patterns, vehicle maintenance windows
-- and route-to-vehicle assignments (schema v005).
--
-- Dated executions of a route are "trips" and live in migration 006.

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
-- reason 'route_update' is written by PATCH /api/routes/:id when a route
-- manager changes a route going forward; datagen only writes the other four.

CREATE TABLE route_assignment (
    assignment_id       TEXT PRIMARY KEY,
    route_id            TEXT NOT NULL REFERENCES route (route_id),
    vehicle_id          TEXT NOT NULL REFERENCES vehicle (vehicle_id),
    valid_from          DATE NOT NULL,
    valid_to            DATE,
    reason              TEXT NOT NULL CHECK (reason IN ('initial','swap','maintenance_cover','maintenance_return','route_update')),
    replaces_vehicle_id TEXT REFERENCES vehicle (vehicle_id),
    schema_version      INTEGER NOT NULL DEFAULT 1,
    generated_at        DATE NOT NULL,
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX idx_route_assignment_route   ON route_assignment (route_id, valid_from);
CREATE INDEX idx_route_assignment_vehicle ON route_assignment (vehicle_id, valid_from);

-- ============================================================================
-- Grants
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON vehicle_maintenance, route_assignment TO assetic_app;