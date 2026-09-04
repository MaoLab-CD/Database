BEGIN;

ALTER TABLE hospital_upload_batches
ADD COLUMN IF NOT EXISTS imported_by BIGINT NULL REFERENCES users(id);

ALTER TABLE hospital_upload_batches
ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ NULL;

ALTER TABLE hospital_upload_batches
ADD COLUMN IF NOT EXISTS import_error TEXT NULL;

ALTER TABLE hospital_upload_batches
DROP CONSTRAINT IF EXISTS ck_hospital_upload_status;

ALTER TABLE hospital_upload_batches
ADD CONSTRAINT ck_hospital_upload_status CHECK (status IN (
    'validation_failed',
    'validated',
    'submitted',
    'approved',
    'rejected',
    'imported',
    'import_failed',
    'cancelled'
));

ALTER TABLE hospital_upload_events
DROP CONSTRAINT IF EXISTS ck_hospital_upload_event_type;

ALTER TABLE hospital_upload_events
ADD CONSTRAINT ck_hospital_upload_event_type CHECK (event_type IN (
    'uploaded',
    'validation_failed',
    'submitted',
    'cancelled',
    'rejected',
    'approved',
    'preview_downloaded',
    'imported',
    'import_failed'
));

COMMIT;
