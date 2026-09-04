BEGIN;

ALTER TABLE sample_import_batches
    DROP CONSTRAINT IF EXISTS ck_import_batch_status;

ALTER TABLE sample_import_batches
    ADD CONSTRAINT ck_import_batch_status
    CHECK (status IN ('previewed', 'imported', 'partial', 'failed', 'cancelled'));

COMMIT;
