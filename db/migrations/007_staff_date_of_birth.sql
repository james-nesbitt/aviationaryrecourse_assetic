-- 007_staff_date_of_birth.sql
--
-- Staff gain a date of birth. Age is deliberately NOT stored: it is a function
-- of the instant the question is asked, and this dataset is read at a fixed
-- anchor (see dataset_anchor_v). Storing a literal age would go stale the
-- moment the anchor moves. Consumers derive age from this column.
--
-- Applied on the rebuild path where the table is empty, so NOT NULL needs no
-- default.

ALTER TABLE staff ADD COLUMN date_of_birth DATE NOT NULL;
ALTER TABLE staff ADD CONSTRAINT staff_dob_before_hire CHECK (date_of_birth < hire_date);

-- Age at the dataset anchor, alongside the staff identity. Kept as a view so
-- that the derivation lives in one place rather than in each caller.
CREATE VIEW staff_age_v AS
SELECT
    s.staff_id,
    s.date_of_birth,
    s.hire_date,
    EXTRACT(YEAR FROM age(a.anchor_date, s.date_of_birth))::int AS age_years,
    EXTRACT(YEAR FROM age(a.anchor_date, s.hire_date))::int     AS years_of_service
FROM staff s
CROSS JOIN dataset_anchor_v a;

GRANT SELECT ON staff_age_v TO assetic_app;