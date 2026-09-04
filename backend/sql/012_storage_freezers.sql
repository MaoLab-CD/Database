BEGIN;

CREATE TABLE IF NOT EXISTS storage_freezers (
    id BIGSERIAL PRIMARY KEY,
    freezer_code VARCHAR(64) NOT NULL UNIQUE,
    temperature_c NUMERIC(6, 1) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_storage_freezers_temperature CHECK (
        temperature_c >= -196 AND temperature_c <= 100
    ),
    CONSTRAINT ck_storage_freezers_code CHECK (
        freezer_code ~ '^[0-9]{3}-[0-9]{2}$'
    )
);

DROP TRIGGER IF EXISTS trg_storage_freezers_updated_at ON storage_freezers;
CREATE TRIGGER trg_storage_freezers_updated_at
BEFORE UPDATE ON storage_freezers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO storage_freezers (
    freezer_code,
    temperature_c,
    is_active
)
VALUES
    ('448-01', -40, true),
    ('448-02', -80, true),
    ('513-01', -40, true),
    ('513-02', 4, true)
ON CONFLICT (freezer_code) DO NOTHING;

COMMIT;
