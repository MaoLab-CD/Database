BEGIN;

CREATE TABLE IF NOT EXISTS specimen_types (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(64) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    allow_batch_code BOOLEAN NOT NULL DEFAULT false,
    uses_plate_wells BOOLEAN NOT NULL DEFAULT false,
    sort_order INTEGER NOT NULL DEFAULT 0,
    note VARCHAR(255) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_specimen_types_name CHECK (name = btrim(name) AND name <> ''),
    CONSTRAINT ck_specimen_types_sort_order CHECK (sort_order >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_specimen_types_name_ci
ON specimen_types (lower(name));

DROP TRIGGER IF EXISTS trg_specimen_types_updated_at ON specimen_types;
CREATE TRIGGER trg_specimen_types_updated_at
BEFORE UPDATE ON specimen_types
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO specimen_types (
    name, is_active, allow_batch_code, uses_plate_wells, sort_order
)
VALUES
    ('全血', true, true, false, 10),
    ('血清', true, false, false, 20),
    ('血浆', true, false, false, 30),
    ('组织', true, false, false, 40),
    ('粪便', true, false, false, 50),
    ('DNA', true, true, true, 60),
    ('RNA', true, false, false, 70),
    ('干粉', true, false, false, 80)
ON CONFLICT (name) DO NOTHING;

COMMIT;
