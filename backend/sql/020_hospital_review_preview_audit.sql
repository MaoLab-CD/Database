BEGIN;

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
    'review_preview_viewed',
    'review_preview_downloaded',
    'imported',
    'import_failed'
));

COMMIT;
