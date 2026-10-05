-- Create the application role with INSERT-only access to the journal
-- and full CRUD on state tables. Run after 001_initial_schema.sql.

-- Role creation (idempotent-ish: use DO block)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'assetic_app') THEN
        CREATE ROLE assetic_app LOGIN PASSWORD 'assetic_dev';
    END IF;
END $$;

-- Journal: SELECT + INSERT only (append-only enforcement at DB level)
GRANT SELECT, INSERT ON journal_entry TO assetic_app;
GRANT USAGE, SELECT ON SEQUENCE journal_entry_journal_id_seq TO assetic_app;

-- State tables: full CRUD
GRANT SELECT, INSERT, UPDATE, DELETE ON
    airport, aircraft_model, operator, vehicle, ownership_history,
    staff, facility, carrier_customer, cargo, route, assetic_order
TO assetic_app;

-- pgcrypto for gen_random_bytes if needed at app layer
GRANT USAGE ON SCHEMA public TO assetic_app;