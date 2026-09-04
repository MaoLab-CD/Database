BEGIN;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS account_type VARCHAR(20) NOT NULL DEFAULT 'internal';

ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_account_type;
ALTER TABLE users ADD CONSTRAINT ck_users_account_type
CHECK (account_type IN ('internal', 'hospital'));

CREATE TABLE IF NOT EXISTS user_center_scopes (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    center_code VARCHAR(64) NOT NULL REFERENCES centers(center_code),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_center_scopes_user_center UNIQUE (user_id, center_code)
);

CREATE INDEX IF NOT EXISTS idx_user_center_scopes_user
ON user_center_scopes(user_id);

CREATE INDEX IF NOT EXISTS idx_user_center_scopes_center
ON user_center_scopes(center_code);

CREATE TABLE IF NOT EXISTS hospital_upload_batches (
    id BIGSERIAL PRIMARY KEY,
    file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_hash CHAR(64) NOT NULL,
    file_size BIGINT NOT NULL,
    template_version VARCHAR(32) NOT NULL DEFAULT 'V1',
    sheet_name VARCHAR(128) NOT NULL,
    center_code VARCHAR(64) NOT NULL REFERENCES centers(center_code),
    uploaded_by BIGINT NOT NULL REFERENCES users(id),
    status VARCHAR(32) NOT NULL,
    total_rows INTEGER NOT NULL DEFAULT 0,
    valid_rows INTEGER NOT NULL DEFAULT 0,
    error_rows INTEGER NOT NULL DEFAULT 0,
    new_rows INTEGER NOT NULL DEFAULT 0,
    duplicate_rows INTEGER NOT NULL DEFAULT 0,
    validation_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_report JSONB NOT NULL DEFAULT '[]'::jsonb,
    submitted_at TIMESTAMPTZ NULL,
    reviewed_by BIGINT NULL REFERENCES users(id),
    reviewed_at TIMESTAMPTZ NULL,
    review_comment TEXT NULL,
    default_status VARCHAR(32) NULL,
    import_batch_id BIGINT NULL REFERENCES sample_import_batches(id),
    cancelled_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_hospital_upload_status CHECK (status IN (
        'validation_failed',
        'validated',
        'submitted',
        'rejected',
        'imported',
        'import_failed',
        'cancelled'
    )),
    CONSTRAINT ck_hospital_upload_file_size CHECK (file_size > 0),
    CONSTRAINT ck_hospital_upload_counts CHECK (
        total_rows >= 0 AND valid_rows >= 0 AND error_rows >= 0
        AND new_rows >= 0 AND duplicate_rows >= 0
    )
);

CREATE INDEX IF NOT EXISTS idx_hospital_upload_batches_uploader
ON hospital_upload_batches(uploaded_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hospital_upload_batches_review
ON hospital_upload_batches(status, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_hospital_upload_batches_center
ON hospital_upload_batches(center_code, created_at DESC);

CREATE TABLE IF NOT EXISTS hospital_upload_events (
    id BIGSERIAL PRIMARY KEY,
    batch_id BIGINT NOT NULL REFERENCES hospital_upload_batches(id) ON DELETE CASCADE,
    actor_id BIGINT NULL REFERENCES users(id),
    event_type VARCHAR(32) NOT NULL,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    client_ip VARCHAR(64) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_hospital_upload_event_type CHECK (event_type IN (
        'uploaded',
        'validation_failed',
        'submitted',
        'cancelled',
        'rejected',
        'approved',
        'import_failed'
    ))
);

CREATE INDEX IF NOT EXISTS idx_hospital_upload_events_batch
ON hospital_upload_events(batch_id, created_at);

DROP TRIGGER IF EXISTS trg_hospital_upload_batches_updated_at ON hospital_upload_batches;
CREATE TRIGGER trg_hospital_upload_batches_updated_at
BEFORE UPDATE ON hospital_upload_batches
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
