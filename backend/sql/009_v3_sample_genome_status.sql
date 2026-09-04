BEGIN;

ALTER TABLE sample_import_batches
    DROP CONSTRAINT IF EXISTS ck_import_batches_import_type;

ALTER TABLE sample_import_batches
    ADD CONSTRAINT ck_import_batches_import_type CHECK (import_type IN (
        'sample',
        'genome',
        'sequencing_send',
        'sequencing_return',
        'qc_feedback'
    ));

CREATE TABLE IF NOT EXISTS sample_genome_status (
    id BIGSERIAL PRIMARY KEY,
    sample_pk BIGINT NOT NULL UNIQUE REFERENCES samples(id) ON DELETE CASCADE,
    sample_id VARCHAR(32) NULL,
    sample_code VARCHAR(128) NOT NULL,
    genome_data_status VARCHAR(64) NULL,
    data_type VARCHAR(64) NULL,
    sequencing_company VARCHAR(128) NULL,
    sequencing_platform VARCHAR(128) NULL,
    sequencing_instrument VARCHAR(128) NULL,
    sequencing_returned_at TIMESTAMPTZ NULL,
    sequencing_depth VARCHAR(64) NULL,
    genome_qc VARCHAR(64) NULL,
    final_status VARCHAR(64) NULL,
    missing_reason TEXT NULL,
    source_file_name VARCHAR(255) NULL,
    sheet_name VARCHAR(128) NULL,
    row_number INTEGER NULL,
    import_batch_id BIGINT NULL REFERENCES sample_import_batches(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_genome_status_sample_code ON sample_genome_status(sample_code);
CREATE INDEX IF NOT EXISTS idx_genome_status_data_status ON sample_genome_status(genome_data_status);
CREATE INDEX IF NOT EXISTS idx_genome_status_final_status ON sample_genome_status(final_status);
CREATE INDEX IF NOT EXISTS idx_genome_status_import_batch ON sample_genome_status(import_batch_id);

DROP TRIGGER IF EXISTS trg_sample_genome_status_updated_at ON sample_genome_status;
CREATE TRIGGER trg_sample_genome_status_updated_at
BEFORE UPDATE ON sample_genome_status
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
