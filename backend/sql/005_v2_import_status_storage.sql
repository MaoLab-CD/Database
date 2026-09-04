BEGIN;

ALTER TABLE samples
    DROP CONSTRAINT IF EXISTS ck_samples_status;

ALTER TABLE samples
    ADD CONSTRAINT ck_samples_status CHECK (sample_status IN (
        'pending',
        'not_stored',
        'sequencing',
        'in_storage',
        'checked_out',
        'return_pending',
        'consumed',
        'lost',
        'discarded',
        'archived'
    ));

ALTER TABLE samples
    DROP CONSTRAINT IF EXISTS ck_samples_sample_seq_format;

ALTER TABLE samples
    ADD CONSTRAINT ck_samples_sample_seq_format
    CHECK (sample_seq IS NULL OR sample_seq ~ '^[0-9]{10}d?$');

ALTER TABLE samples
    DROP CONSTRAINT IF EXISTS ck_samples_code_format;

ALTER TABLE samples
    DROP CONSTRAINT IF EXISTS ck_samples_sample_code_format;

ALTER TABLE samples
    ADD CONSTRAINT ck_samples_sample_code_format
    CHECK (sample_code IS NULL OR sample_code ~ '^[0-9]{6}-[0-9]{3}-[0-9]{10}d?$');

ALTER TABLE sample_return_records
    ADD COLUMN IF NOT EXISTS purpose TEXT NULL,
    ADD COLUMN IF NOT EXISTS used_volume_ul DECIMAL(12,4) NULL;

ALTER TABLE sample_import_batches
    ADD COLUMN IF NOT EXISTS import_type VARCHAR(32) NOT NULL DEFAULT 'sample';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_import_batches_import_type'
          AND conrelid = 'sample_import_batches'::regclass
    ) THEN
        ALTER TABLE sample_import_batches
            ADD CONSTRAINT ck_import_batches_import_type CHECK (import_type IN (
                'sample',
                'sequencing_send',
                'sequencing_return',
                'qc_feedback'
            ));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS sample_storage (
    id BIGSERIAL PRIMARY KEY,
    sample_pk BIGINT NOT NULL UNIQUE REFERENCES samples(id) ON DELETE CASCADE,
    sample_id VARCHAR(32) NOT NULL,
    sample_code VARCHAR(128) NULL,
    freezer_no VARCHAR(64) NULL,
    shelf_no VARCHAR(64) NULL,
    box_no VARCHAR(64) NULL,
    storage_position VARCHAR(128) NULL,
    initial_volume_ul DECIMAL(12,4) NULL,
    remaining_volume_ul DECIMAL(12,4) NULL,
    initial_amount_ug DECIMAL(12,6) NULL,
    remaining_amount_ug DECIMAL(12,6) NULL,
    note TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_sample_storage_updated_at ON sample_storage;
CREATE TRIGGER trg_sample_storage_updated_at
BEFORE UPDATE ON sample_storage
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
