BEGIN;

ALTER TABLE sample_import_batches
DROP CONSTRAINT IF EXISTS ck_import_batches_import_type;

ALTER TABLE sample_import_batches
ADD CONSTRAINT ck_import_batches_import_type CHECK (
    import_type IN (
        'sample',
        'genome',
        'sequencing_send',
        'sequencing_return',
        'qc_feedback',
        'dna_plate'
    )
);

COMMIT;
