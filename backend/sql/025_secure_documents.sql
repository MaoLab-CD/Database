BEGIN;

CREATE TABLE IF NOT EXISTS secure_documents (
    id BIGSERIAL PRIMARY KEY,
    document_type VARCHAR(64) NOT NULL,
    scope_type VARCHAR(32) NOT NULL,
    sample_pk BIGINT NULL REFERENCES samples(id),
    center_code VARCHAR(32) NULL REFERENCES centers(center_code),
    title VARCHAR(255) NOT NULL,
    coverage_note TEXT NULL,
    original_file_name VARCHAR(255) NOT NULL,
    stored_file_name VARCHAR(255) NOT NULL UNIQUE,
    relative_path TEXT NOT NULL UNIQUE,
    mime_type VARCHAR(128) NOT NULL DEFAULT 'application/pdf',
    file_size BIGINT NOT NULL,
    file_sha256 CHAR(64) NOT NULL,
    encryption_version SMALLINT NOT NULL DEFAULT 1,
    uploaded_by BIGINT NOT NULL REFERENCES users(id),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_by BIGINT NULL REFERENCES users(id),
    deleted_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_secure_document_type CHECK (
        document_type IN ('organoid_report', 'informed_consent_bundle', 'other')
    ),
    CONSTRAINT ck_secure_document_scope CHECK (
        scope_type IN ('sample', 'collection')
    ),
    CONSTRAINT ck_secure_document_scope_target CHECK (
        (scope_type = 'sample' AND sample_pk IS NOT NULL)
        OR (scope_type = 'collection' AND sample_pk IS NULL)
    ),
    CONSTRAINT ck_secure_document_file_size CHECK (file_size > 0),
    CONSTRAINT ck_secure_document_sha256 CHECK (file_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_secure_documents_sample
ON secure_documents(sample_pk, created_at DESC)
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_secure_documents_collection
ON secure_documents(scope_type, document_type, created_at DESC)
WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_secure_documents_center
ON secure_documents(center_code, created_at DESC)
WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS secure_document_events (
    id BIGSERIAL PRIMARY KEY,
    document_id BIGINT NOT NULL REFERENCES secure_documents(id),
    actor_id BIGINT NULL REFERENCES users(id),
    event_type VARCHAR(32) NOT NULL,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    client_ip VARCHAR(64) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_secure_document_event_type CHECK (
        event_type IN ('uploaded', 'previewed', 'downloaded', 'deleted')
    )
);

CREATE INDEX IF NOT EXISTS idx_secure_document_events_document
ON secure_document_events(document_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_secure_documents_updated_at ON secure_documents;
CREATE TRIGGER trg_secure_documents_updated_at
BEFORE UPDATE ON secure_documents
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
