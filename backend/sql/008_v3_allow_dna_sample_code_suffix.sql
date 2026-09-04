BEGIN;

ALTER TABLE samples
    DROP CONSTRAINT IF EXISTS ck_samples_code_format;

ALTER TABLE samples
    DROP CONSTRAINT IF EXISTS ck_samples_sample_code_format;

ALTER TABLE samples
    DROP CONSTRAINT IF EXISTS ck_samples_sample_seq_format;

ALTER TABLE samples
    ADD CONSTRAINT ck_samples_sample_code_format
    CHECK (sample_code IS NULL OR sample_code ~ '^[0-9]{6}-[0-9]{3}-[0-9]{10}d?$');

ALTER TABLE samples
    ADD CONSTRAINT ck_samples_sample_seq_format
    CHECK (sample_seq IS NULL OR sample_seq ~ '^[0-9]{10}d?$');

COMMIT;
