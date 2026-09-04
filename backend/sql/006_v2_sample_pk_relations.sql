BEGIN;

-- V2: use samples.id as the internal relation key.
-- Run this after clearing business data. It intentionally keeps samples.sample_id
-- as the original source id, but removes its uniqueness requirement.

TRUNCATE TABLE
    private_info_access_logs,
    sample_movement_logs,
    sample_return_records,
    sample_usage_records,
    sample_checkout_records,
    sample_storage,
    participant_private_info,
    sample_raw_records,
    sequencing_data_records,
    sequencing_scan_batches,
    samples
RESTART IDENTITY CASCADE;

ALTER TABLE participant_private_info
    DROP CONSTRAINT IF EXISTS participant_private_info_sample_id_fkey,
    DROP CONSTRAINT IF EXISTS participant_private_info_sample_id_key,
    ADD COLUMN IF NOT EXISTS sample_pk BIGINT,
    ALTER COLUMN sample_id DROP NOT NULL;

ALTER TABLE participant_private_info
    ALTER COLUMN sample_pk SET NOT NULL,
    ADD CONSTRAINT participant_private_info_sample_pk_fkey
        FOREIGN KEY (sample_pk) REFERENCES samples(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_private_info_sample_pk
ON participant_private_info(sample_pk);

ALTER TABLE sample_raw_records
    DROP CONSTRAINT IF EXISTS sample_raw_records_sample_id_fkey,
    DROP CONSTRAINT IF EXISTS sample_raw_records_sample_id_key,
    ADD COLUMN IF NOT EXISTS sample_pk BIGINT,
    ALTER COLUMN sample_id DROP NOT NULL;

ALTER TABLE sample_raw_records
    ALTER COLUMN sample_pk SET NOT NULL,
    ADD CONSTRAINT sample_raw_records_sample_pk_fkey
        FOREIGN KEY (sample_pk) REFERENCES samples(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_records_sample_pk
ON sample_raw_records(sample_pk);

ALTER TABLE sample_checkout_records
    DROP CONSTRAINT IF EXISTS sample_checkout_records_sample_id_fkey,
    ADD COLUMN IF NOT EXISTS sample_pk BIGINT,
    ALTER COLUMN sample_id DROP NOT NULL;

ALTER TABLE sample_checkout_records
    ALTER COLUMN sample_pk SET NOT NULL,
    ADD CONSTRAINT sample_checkout_records_sample_pk_fkey
        FOREIGN KEY (sample_pk) REFERENCES samples(id);

DROP INDEX IF EXISTS uq_checkout_active_sample;
CREATE UNIQUE INDEX IF NOT EXISTS uq_checkout_active_sample
ON sample_checkout_records(sample_pk)
WHERE status = 'active';

ALTER TABLE sample_usage_records
    DROP CONSTRAINT IF EXISTS sample_usage_records_sample_id_fkey,
    ADD COLUMN IF NOT EXISTS sample_pk BIGINT,
    ALTER COLUMN sample_id DROP NOT NULL;

ALTER TABLE sample_usage_records
    ALTER COLUMN sample_pk SET NOT NULL,
    ADD CONSTRAINT sample_usage_records_sample_pk_fkey
        FOREIGN KEY (sample_pk) REFERENCES samples(id);

ALTER TABLE sample_return_records
    DROP CONSTRAINT IF EXISTS sample_return_records_sample_id_fkey,
    ADD COLUMN IF NOT EXISTS sample_pk BIGINT,
    ALTER COLUMN sample_id DROP NOT NULL;

ALTER TABLE sample_return_records
    ALTER COLUMN sample_pk SET NOT NULL,
    ADD CONSTRAINT sample_return_records_sample_pk_fkey
        FOREIGN KEY (sample_pk) REFERENCES samples(id);

ALTER TABLE sample_movement_logs
    ADD COLUMN IF NOT EXISTS sample_pk BIGINT,
    ADD COLUMN IF NOT EXISTS sample_code VARCHAR(128);

ALTER TABLE sample_movement_logs
    ADD CONSTRAINT sample_movement_logs_sample_pk_fkey
        FOREIGN KEY (sample_pk) REFERENCES samples(id);

CREATE INDEX IF NOT EXISTS idx_movement_sample_pk ON sample_movement_logs(sample_pk);
CREATE INDEX IF NOT EXISTS idx_movement_sample_code ON sample_movement_logs(sample_code);

ALTER TABLE private_info_access_logs
    ADD COLUMN IF NOT EXISTS sample_pk BIGINT,
    ADD COLUMN IF NOT EXISTS sample_code VARCHAR(128);

ALTER TABLE private_info_access_logs
    ADD CONSTRAINT private_info_access_logs_sample_pk_fkey
        FOREIGN KEY (sample_pk) REFERENCES samples(id);

CREATE INDEX IF NOT EXISTS idx_private_access_sample_pk ON private_info_access_logs(sample_pk);
CREATE INDEX IF NOT EXISTS idx_private_access_sample_code ON private_info_access_logs(sample_code);

ALTER TABLE sample_storage
    DROP CONSTRAINT IF EXISTS sample_storage_sample_id_fkey,
    DROP CONSTRAINT IF EXISTS sample_storage_sample_id_key,
    ADD COLUMN IF NOT EXISTS sample_pk BIGINT,
    ADD COLUMN IF NOT EXISTS sample_code VARCHAR(128),
    ALTER COLUMN sample_id DROP NOT NULL;

ALTER TABLE sample_storage
    ALTER COLUMN sample_pk SET NOT NULL,
    ADD CONSTRAINT sample_storage_sample_pk_fkey
        FOREIGN KEY (sample_pk) REFERENCES samples(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sample_storage_sample_pk
ON sample_storage(sample_pk);

ALTER TABLE samples
    DROP CONSTRAINT IF EXISTS samples_sample_id_key;

CREATE INDEX IF NOT EXISTS idx_samples_sample_id ON samples(sample_id);

COMMIT;
