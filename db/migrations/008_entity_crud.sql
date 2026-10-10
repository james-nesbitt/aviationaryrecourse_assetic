-- 008_entity_crud.sql
--
-- Soft delete for entity CRUD. Deletes are a recording of intent, not an
-- erasure: the journal is the source of truth and the DB holds foreign
-- keys, so a delete marks the row (deleted_at) and every read filters on
-- it. Hard DELETE would break FK chains and destroy audit history.
--
-- Applied on the rebuild path where tables are empty.

-- Soft-delete stamp on every entity table the CRUD surface covers.
ALTER TABLE operator           ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE vehicle             ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE route               ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE trip                ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE vehicle_maintenance ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE route_assignment    ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE crew_assignment     ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE staff               ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE carrier_customer    ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE assetic_order       ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE cargo               ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE passenger           ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE airport             ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE aircraft_model      ADD COLUMN deleted_at TIMESTAMPTZ;

-- Partial indexes make the soft-delete filter cheap on every read.
CREATE INDEX idx_operator_deleted   ON operator (operator_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_vehicle_deleted    ON vehicle (vehicle_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_route_deleted      ON route (route_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_trip_deleted       ON trip (trip_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_vm_deleted         ON vehicle_maintenance (maintenance_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_ra_deleted         ON route_assignment (assignment_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_ca_deleted         ON crew_assignment (assignment_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_staff_deleted      ON staff (staff_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_customer_deleted   ON carrier_customer (customer_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_order_deleted      ON assetic_order (order_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_cargo_deleted      ON cargo (cargo_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_passenger_deleted  ON passenger (passenger_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_airport_deleted    ON airport (iata) WHERE deleted_at IS NULL;
CREATE INDEX idx_model_deleted      ON aircraft_model (model_id) WHERE deleted_at IS NULL;

-- Journal: a delete is an event like any other.
ALTER TABLE journal_entry DROP CONSTRAINT journal_entry_event_type_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_event_type_check
    CHECK (event_type = ANY (ARRAY[
      'custody.accepted'::text, 'custody.transferred'::text,
      'approval.proposed'::text, 'approval.approved'::text, 'approval.rejected'::text,
      'payment.initiated'::text, 'payment.completed'::text,
      'boarding'::text, 'loading'::text, 'departure'::text, 'arrival'::text,
      'dispatch.created'::text, 'dispatch.updated'::text, 'dispatch.deleted'::text,
      'agent.action'::text]));