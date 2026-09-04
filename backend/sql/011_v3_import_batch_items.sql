BEGIN;

CREATE TABLE IF NOT EXISTS sample_import_items (
    id BIGSERIAL PRIMARY KEY,
    import_batch_id BIGINT NOT NULL REFERENCES sample_import_batches(id),
    sample_pk BIGINT NOT NULL REFERENCES samples(id),
    sample_code VARCHAR(128) NOT NULL,
    row_number INTEGER NULL,
    action_type VARCHAR(16) NOT NULL,
    removed_at TIMESTAMPTZ NULL,
    removed_by BIGINT NULL REFERENCES users(id),
    remove_reason TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_sample_import_items_action CHECK (action_type IN ('created', 'updated')),
    CONSTRAINT uq_sample_import_items_batch_sample UNIQUE (import_batch_id, sample_pk)
);

CREATE INDEX IF NOT EXISTS idx_sample_import_items_batch
    ON sample_import_items(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_sample_import_items_sample
    ON sample_import_items(sample_pk);
CREATE INDEX IF NOT EXISTS idx_sample_import_items_code
    ON sample_import_items(sample_code);

COMMIT;
