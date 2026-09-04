BEGIN;

-- Clean schema snapshot for new deployments.
-- This file merges the current stable structure from migrations 001-026.
--
-- Usage for a new empty database:
--   psql -h <host> -U <user> -d sample_admin -f backend/sql/schema_latest.sql
--   python backend/scripts/seed_users.py --username maolab
--
-- This file creates tables, indexes, triggers, and dictionary seed data.
-- It does not create login users.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_center_code()
RETURNS TRIGGER AS $$
BEGIN
    NEW.center_code := NEW.district_code || '-' || NEW.hospital_seq;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_sample_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.center_code IS NOT NULL AND NEW.sample_seq IS NOT NULL THEN
        NEW.sample_code := NEW.center_code || '-' || NEW.sample_seq;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    password_changed_at TIMESTAMPTZ NULL,
    password_reset_required BOOLEAN NOT NULL DEFAULT false,
    token_version INTEGER NOT NULL DEFAULT 0,
    display_name VARCHAR(64) NOT NULL,
    role VARCHAR(20) NOT NULL,
    is_super_admin BOOLEAN NOT NULL DEFAULT false,
    permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    last_login_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    account_type VARCHAR(20) NOT NULL DEFAULT 'internal',
    CONSTRAINT ck_users_role CHECK (role IN ('admin', 'user')),
    CONSTRAINT ck_users_status CHECK (status IN ('active', 'disabled')),
    CONSTRAINT ck_users_token_version CHECK (token_version >= 0),
    CONSTRAINT ck_users_account_type CHECK (account_type IN ('internal', 'hospital')),
    CONSTRAINT ck_users_hospital_upload_only CHECK (
        account_type <> 'hospital'
        OR (
            role = 'user'
            AND is_super_admin = false
            AND permissions = '{"hospital_data_submit": true}'::jsonb
        )
    )
);

CREATE TABLE IF NOT EXISTS auth_login_rate_limits (
    id BIGSERIAL PRIMARY KEY,
    identifier_type VARCHAR(16) NOT NULL,
    identifier_hash CHAR(64) NOT NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_until TIMESTAMPTZ NULL,
    last_failed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_auth_login_rate_limits_type CHECK (
        identifier_type IN ('account', 'ip')
    ),
    CONSTRAINT ck_auth_login_rate_limits_attempts CHECK (
        failed_attempts >= 0
    ),
    CONSTRAINT uq_auth_login_rate_limits_identifier UNIQUE (
        identifier_type,
        identifier_hash
    )
);

CREATE INDEX IF NOT EXISTS idx_auth_login_rate_limits_updated_at
ON auth_login_rate_limits(updated_at);

CREATE TABLE IF NOT EXISTS districts (
    district_code VARCHAR(6) PRIMARY KEY,
    district_name VARCHAR(100) NOT NULL,
    city_name VARCHAR(100) NULL,
    province VARCHAR(64) NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_districts_code CHECK (district_code ~ '^[0-9]{6}$')
);

CREATE TABLE IF NOT EXISTS centers (
    id BIGSERIAL PRIMARY KEY,
    center_code VARCHAR(64) NOT NULL UNIQUE,
    center_name VARCHAR(128) NOT NULL,
    province VARCHAR(64) NULL,
    district_code VARCHAR(6) NOT NULL REFERENCES districts(district_code),
    region VARCHAR(64) NULL,
    hospital_seq VARCHAR(3) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_centers_hospital_seq CHECK (hospital_seq ~ '^[0-9]{3}$'),
    CONSTRAINT ck_centers_code_format CHECK (center_code ~ '^[0-9]{6}-[0-9]{3}$'),
    CONSTRAINT uq_centers_district_seq UNIQUE (district_code, hospital_seq)
);

CREATE TABLE IF NOT EXISTS storage_freezers (
    id BIGSERIAL PRIMARY KEY,
    freezer_code VARCHAR(64) NOT NULL UNIQUE,
    temperature_c NUMERIC(6, 1) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_storage_freezers_temperature CHECK (
        temperature_c >= -196 AND temperature_c <= 100
    ),
    CONSTRAINT ck_storage_freezers_code CHECK (
        freezer_code ~ '^[0-9]{3}-[0-9]{2}$'
    )
);

CREATE TABLE IF NOT EXISTS sample_import_batches (
    id BIGSERIAL PRIMARY KEY,
    file_name VARCHAR(255) NOT NULL,
    file_path TEXT NULL,
    file_hash VARCHAR(128) NULL,
    uploaded_by BIGINT NULL REFERENCES users(id),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    total_rows INTEGER NOT NULL DEFAULT 0,
    success_rows INTEGER NOT NULL DEFAULT 0,
    failed_rows INTEGER NOT NULL DEFAULT 0,
    import_type VARCHAR(32) NOT NULL DEFAULT 'sample',
    status VARCHAR(32) NOT NULL,
    error_report JSONB NOT NULL DEFAULT '[]'::jsonb,
    field_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sample_import_batches DROP CONSTRAINT IF EXISTS ck_import_batch_status;
ALTER TABLE sample_import_batches ADD CONSTRAINT ck_import_batch_status CHECK (status IN ('previewed', 'imported', 'partial', 'failed', 'cancelled'));

ALTER TABLE sample_import_batches DROP CONSTRAINT IF EXISTS ck_import_batches_import_type;
ALTER TABLE sample_import_batches ADD CONSTRAINT ck_import_batches_import_type CHECK (import_type IN ('sample', 'genome', 'sequencing_send', 'sequencing_return', 'qc_feedback', 'dna_plate'));

CREATE TABLE IF NOT EXISTS user_center_scopes (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    center_code VARCHAR(64) NOT NULL REFERENCES centers(center_code),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_center_scopes_user_center UNIQUE (user_id, center_code)
);

CREATE INDEX IF NOT EXISTS idx_user_center_scopes_user ON user_center_scopes(user_id);
CREATE INDEX IF NOT EXISTS idx_user_center_scopes_center ON user_center_scopes(center_code);

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
    imported_by BIGINT NULL REFERENCES users(id),
    imported_at TIMESTAMPTZ NULL,
    import_error TEXT NULL,
    cancelled_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_hospital_upload_status CHECK (status IN ('validation_failed', 'validated', 'submitted', 'approved', 'rejected', 'imported', 'import_failed', 'cancelled')),
    CONSTRAINT ck_hospital_upload_file_size CHECK (file_size > 0),
    CONSTRAINT ck_hospital_upload_counts CHECK (total_rows >= 0 AND valid_rows >= 0 AND error_rows >= 0 AND new_rows >= 0 AND duplicate_rows >= 0)
);

CREATE INDEX IF NOT EXISTS idx_hospital_upload_batches_uploader ON hospital_upload_batches(uploaded_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hospital_upload_batches_review ON hospital_upload_batches(status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_hospital_upload_batches_center ON hospital_upload_batches(center_code, created_at DESC);

CREATE TABLE IF NOT EXISTS hospital_upload_events (
    id BIGSERIAL PRIMARY KEY,
    batch_id BIGINT NOT NULL REFERENCES hospital_upload_batches(id) ON DELETE CASCADE,
    actor_id BIGINT NULL REFERENCES users(id),
    event_type VARCHAR(32) NOT NULL,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    client_ip VARCHAR(64) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_hospital_upload_event_type CHECK (event_type IN ('uploaded', 'validation_failed', 'submitted', 'cancelled', 'rejected', 'approved', 'preview_downloaded', 'review_preview_viewed', 'review_preview_downloaded', 'submission_preview_viewed', 'imported', 'import_failed'))
);

CREATE INDEX IF NOT EXISTS idx_hospital_upload_events_batch ON hospital_upload_events(batch_id, created_at);

CREATE TABLE IF NOT EXISTS samples (
    id BIGSERIAL PRIMARY KEY,
    sample_id VARCHAR(32) NOT NULL,
    center_code VARCHAR(64) NULL REFERENCES centers(center_code),
    sample_seq VARCHAR(16) NULL,
    sample_code VARCHAR(128) NULL,
    barcode_no VARCHAR(64) NULL,
    experiment_no VARCHAR(64) NULL,
    patient_no VARCHAR(64) NULL,
    source_batch VARCHAR(64) NULL,
    ethnicity VARCHAR(64) NULL,
    sex VARCHAR(20) NULL,
    age VARCHAR(32) NULL,
    visit_type VARCHAR(64) NULL,
    department VARCHAR(128) NULL,
    bed_no VARCHAR(64) NULL,
    doctor VARCHAR(64) NULL,
    diagnosis TEXT NULL,
    request_items TEXT NULL,
    test_priority VARCHAR(64) NULL,
    specimen_type VARCHAR(64) NULL,
    device VARCHAR(64) NULL,
    collection_time TIMESTAMPTZ NULL,
    received_time TIMESTAMPTZ NULL,
    machine_time TIMESTAMPTZ NULL,
    review_time TIMESTAMPTZ NULL,
    sample_status VARCHAR(32) NOT NULL DEFAULT 'not_stored',
    sequencing_status VARCHAR(32) NOT NULL DEFAULT 'none',
    storage_location VARCHAR(128) NULL,
    current_holder_id BIGINT NULL REFERENCES users(id),
    note TEXT NULL,
    extra_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_by BIGINT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by BIGINT NULL REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_samples_status CHECK (sample_status IN (
        'pending',
        'not_stored',
        'sequencing',
        'in_storage',
        'checked_out',
        'return_pending',
        'consumed',
        'lost',
        'discarded',
        'archived'
    )),
    CONSTRAINT ck_samples_seq_status CHECK (sequencing_status IN (
        'none',
        'available',
        'incomplete',
        'unmatched',
        'changed',
        'missing',
        'archived'
    )),
    CONSTRAINT ck_samples_sample_seq_format CHECK (sample_seq IS NULL OR sample_seq ~ '^[0-9]{10}[A-Za-z]?$'),
    CONSTRAINT ck_samples_sample_code_format CHECK (sample_code IS NULL OR sample_code ~ '^[0-9]{6}-[0-9]{3}-[0-9]{10}[A-Za-z]?$')
);

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

CREATE TABLE IF NOT EXISTS participant_private_info (
    id BIGSERIAL PRIMARY KEY,
    sample_pk BIGINT NOT NULL UNIQUE REFERENCES samples(id) ON DELETE CASCADE,
    sample_id VARCHAR(32) NULL,
    patient_no VARCHAR(64) NULL,
    name_encrypted TEXT NULL,
    id_card_no_encrypted TEXT NULL,
    id_card_hash VARCHAR(128) NULL,
    phone_encrypted TEXT NULL,
    phone_hash VARCHAR(128) NULL,
    address_encrypted TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sample_raw_records (
    id BIGSERIAL PRIMARY KEY,
    sample_pk BIGINT NOT NULL UNIQUE REFERENCES samples(id) ON DELETE CASCADE,
    sample_id VARCHAR(32) NULL,
    import_batch_id BIGINT NULL REFERENCES sample_import_batches(id),
    source_file_name VARCHAR(255) NOT NULL,
    sheet_name VARCHAR(128) NOT NULL,
    row_number INTEGER NOT NULL,
    raw_data JSONB NOT NULL,
    visible_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    lab_results JSONB NOT NULL DEFAULT '{}'::jsonb,
    ignored_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sample_storage (
    id BIGSERIAL PRIMARY KEY,
    sample_pk BIGINT NOT NULL UNIQUE REFERENCES samples(id) ON DELETE CASCADE,
    sample_id VARCHAR(32) NULL,
    sample_code VARCHAR(128) NULL,
    freezer_no VARCHAR(64) NULL,
    shelf_no VARCHAR(64) NULL,
    box_no VARCHAR(64) NULL,
    storage_position VARCHAR(128) NULL,
    initial_volume_ul DECIMAL(12,4) NULL,
    remaining_volume_ul DECIMAL(12,4) NULL,
    initial_amount_ug DECIMAL(12,6) NULL,
    remaining_amount_ug DECIMAL(12,6) NULL,
    note TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sample_plates (
    id BIGSERIAL PRIMARY KEY,
    plate_code VARCHAR(128) NOT NULL UNIQUE,
    plate_type VARCHAR(32) NOT NULL DEFAULT '96_well',
    row_count INTEGER NOT NULL DEFAULT 8,
    column_count INTEGER NOT NULL DEFAULT 12,
    freezer_id BIGINT NULL REFERENCES storage_freezers(id),
    layer_no VARCHAR(64) NULL,
    container_no VARCHAR(64) NULL,
    location_note TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by BIGINT NULL REFERENCES users(id),
    updated_by BIGINT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_sample_plates_type CHECK (plate_type IN ('96_well')),
    CONSTRAINT ck_sample_plates_dimensions CHECK (
        row_count BETWEEN 1 AND 26
        AND column_count BETWEEN 1 AND 99
    )
);

CREATE TABLE IF NOT EXISTS sample_relations (
    id BIGSERIAL PRIMARY KEY,
    parent_sample_pk BIGINT NOT NULL REFERENCES samples(id),
    child_sample_pk BIGINT NOT NULL REFERENCES samples(id),
    relation_type VARCHAR(32) NOT NULL,
    created_by BIGINT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_sample_relations_distinct_samples CHECK (
        parent_sample_pk <> child_sample_pk
    ),
    CONSTRAINT uq_sample_relations_pair UNIQUE (
        parent_sample_pk,
        child_sample_pk,
        relation_type
    ),
    CONSTRAINT uq_sample_relations_child_type UNIQUE (
        child_sample_pk,
        relation_type
    )
);

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
    CONSTRAINT ck_secure_document_scope CHECK (scope_type IN ('sample', 'collection')),
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

CREATE TABLE IF NOT EXISTS sample_plate_wells (
    id BIGSERIAL PRIMARY KEY,
    plate_id BIGINT NOT NULL REFERENCES sample_plates(id),
    well_code VARCHAR(8) NOT NULL,
    sample_pk BIGINT NOT NULL REFERENCES samples(id),
    import_batch_id BIGINT NULL REFERENCES sample_import_batches(id),
    placed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    placed_by BIGINT NULL REFERENCES users(id),
    removed_at TIMESTAMPTZ NULL,
    removed_by BIGINT NULL REFERENCES users(id),
    note TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_sample_plate_wells_code CHECK (
        well_code ~ '^[A-Z](0[1-9]|[1-9][0-9])$'
    ),
    CONSTRAINT ck_sample_plate_wells_removed_after_placed CHECK (
        removed_at IS NULL OR removed_at >= placed_at
    )
);

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

CREATE TABLE IF NOT EXISTS sequencing_scan_batches (
    id BIGSERIAL PRIMARY KEY,
    scan_root_path TEXT NOT NULL,
    scan_mode VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ NULL,
    total_projects INTEGER NOT NULL DEFAULT 0,
    total_sample_dirs INTEGER NOT NULL DEFAULT 0,
    new_count INTEGER NOT NULL DEFAULT 0,
    existing_count INTEGER NOT NULL DEFAULT 0,
    changed_count INTEGER NOT NULL DEFAULT 0,
    missing_count INTEGER NOT NULL DEFAULT 0,
    unmatched_count INTEGER NOT NULL DEFAULT 0,
    incomplete_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT NULL,
    created_by BIGINT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_scan_mode CHECK (scan_mode IN ('full', 'incremental')),
    CONSTRAINT ck_scan_status CHECK (status IN ('running', 'completed', 'failed', 'confirmed'))
);

CREATE TABLE IF NOT EXISTS sequencing_data_records (
    id BIGSERIAL PRIMARY KEY,
    sample_id VARCHAR(32) NOT NULL,
    sample_code VARCHAR(128) NULL,
    project_code VARCHAR(128) NOT NULL,
    data_root_path TEXT NOT NULL,
    raw_data_path TEXT NOT NULL,
    r1_file_name VARCHAR(255) NULL,
    r2_file_name VARCHAR(255) NULL,
    md5_file_name VARCHAR(255) NULL,
    r1_file_size BIGINT NULL,
    r2_file_size BIGINT NULL,
    total_size_bytes BIGINT NULL,
    file_modified_at TIMESTAMPTZ NULL,
    md5_values JSONB NOT NULL DEFAULT '{}'::jsonb,
    data_status VARCHAR(32) NOT NULL,
    scan_batch_id BIGINT NULL REFERENCES sequencing_scan_batches(id),
    last_scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    note TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_seq_data_status CHECK (data_status IN (
        'none',
        'available',
        'incomplete',
        'unmatched',
        'changed',
        'missing',
        'archived'
    ))
);

CREATE TABLE IF NOT EXISTS sample_checkout_records (
    id BIGSERIAL PRIMARY KEY,
    sample_pk BIGINT NOT NULL REFERENCES samples(id),
    sample_id VARCHAR(32) NULL,
    checkout_user_id BIGINT NOT NULL REFERENCES users(id),
    project_name VARCHAR(128) NULL,
    purpose TEXT NULL,
    checkout_time TIMESTAMPTZ NOT NULL DEFAULT now(),
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    note TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_checkout_status CHECK (status IN ('active', 'returned', 'closed', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS sample_usage_records (
    id BIGSERIAL PRIMARY KEY,
    sample_pk BIGINT NOT NULL REFERENCES samples(id),
    sample_id VARCHAR(32) NULL,
    checkout_record_id BIGINT NULL REFERENCES sample_checkout_records(id),
    user_id BIGINT NOT NULL REFERENCES users(id),
    project_name VARCHAR(128) NULL,
    purpose TEXT NULL,
    used_amount VARCHAR(64) NULL,
    unit VARCHAR(32) NULL,
    used_time TIMESTAMPTZ NULL,
    experiment_batch VARCHAR(128) NULL,
    note TEXT NULL,
    attachment_path TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sample_return_records (
    id BIGSERIAL PRIMARY KEY,
    sample_pk BIGINT NOT NULL REFERENCES samples(id),
    sample_id VARCHAR(32) NULL,
    checkout_record_id BIGINT NOT NULL REFERENCES sample_checkout_records(id),
    returned_by BIGINT NOT NULL REFERENCES users(id),
    return_requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_by BIGINT NULL REFERENCES users(id),
    confirmed_at TIMESTAMPTZ NULL,
    used_amount VARCHAR(64) NULL,
    unit VARCHAR(32) NULL,
    purpose TEXT NULL,
    used_volume_ul DECIMAL(12,4) NULL,
    return_location VARCHAR(128) NULL,
    is_consumed BOOLEAN NOT NULL DEFAULT false,
    final_status VARCHAR(32) NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    note TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_return_status CHECK (status IN ('pending', 'confirmed', 'cancelled')),
    CONSTRAINT ck_return_final_status CHECK (
        final_status IS NULL
        OR final_status IN ('in_storage', 'consumed', 'lost', 'discarded')
    )
);

CREATE TABLE IF NOT EXISTS sample_movement_logs (
    id BIGSERIAL PRIMARY KEY,
    sample_pk BIGINT NULL REFERENCES samples(id),
    sample_id VARCHAR(32) NULL,
    sample_code VARCHAR(128) NULL,
    action_type VARCHAR(64) NOT NULL,
    before_status VARCHAR(32) NULL,
    after_status VARCHAR(32) NULL,
    before_location VARCHAR(128) NULL,
    after_location VARCHAR(128) NULL,
    operator_id BIGINT NULL REFERENCES users(id),
    operator_role VARCHAR(20) NULL,
    related_record_id BIGINT NULL,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    note TEXT NULL,
    ip_address VARCHAR(64) NULL,
    device_info TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS private_info_access_logs (
    id BIGSERIAL PRIMARY KEY,
    sample_pk BIGINT NULL REFERENCES samples(id),
    sample_id VARCHAR(32) NOT NULL,
    sample_code VARCHAR(128) NULL,
    viewer_id BIGINT NOT NULL REFERENCES users(id),
    viewer_role VARCHAR(20) NOT NULL,
    viewed_fields JSONB NOT NULL,
    view_reason TEXT NULL,
    access_type VARCHAR(32) NOT NULL,
    ip_address VARCHAR(64) NULL,
    device_info TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_private_access_type CHECK (access_type IN ('view', 'export'))
);

CREATE TABLE IF NOT EXISTS database_backup_records (
    id BIGSERIAL PRIMARY KEY,
    backup_type VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    backup_file_path TEXT NULL,
    file_size_bytes BIGINT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ NULL,
    triggered_by BIGINT NULL REFERENCES users(id),
    error_message TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_backup_type CHECK (backup_type IN ('manual', 'scheduled')),
    CONSTRAINT ck_backup_status CHECK (status IN ('running', 'success', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_centers_district_code ON centers(district_code);
CREATE INDEX IF NOT EXISTS idx_centers_is_active ON centers(is_active);

CREATE INDEX IF NOT EXISTS idx_samples_sample_id ON samples(sample_id);
CREATE INDEX IF NOT EXISTS idx_samples_barcode_no ON samples(barcode_no);
CREATE INDEX IF NOT EXISTS idx_samples_patient_no ON samples(patient_no);
CREATE INDEX IF NOT EXISTS idx_samples_ethnicity ON samples(ethnicity);
CREATE INDEX IF NOT EXISTS idx_samples_status ON samples(sample_status);
CREATE INDEX IF NOT EXISTS idx_samples_sequencing_status ON samples(sequencing_status);
CREATE INDEX IF NOT EXISTS idx_samples_collection_time ON samples(collection_time);
CREATE INDEX IF NOT EXISTS idx_samples_center_code ON samples(center_code);
CREATE INDEX IF NOT EXISTS idx_samples_sample_seq ON samples(sample_seq);
CREATE UNIQUE INDEX IF NOT EXISTS uq_samples_center_seq
ON samples(center_code, sample_seq)
WHERE is_deleted = false AND center_code IS NOT NULL AND sample_seq IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_samples_code
ON samples(sample_code)
WHERE is_deleted = false AND sample_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sample_plates_freezer ON sample_plates(freezer_id);
CREATE INDEX IF NOT EXISTS idx_sample_relations_parent ON sample_relations(parent_sample_pk);
CREATE INDEX IF NOT EXISTS idx_sample_relations_child ON sample_relations(child_sample_pk);
CREATE INDEX IF NOT EXISTS idx_sample_plate_wells_plate ON sample_plate_wells(plate_id);
CREATE INDEX IF NOT EXISTS idx_sample_plate_wells_sample ON sample_plate_wells(sample_pk);
CREATE INDEX IF NOT EXISTS idx_sample_plate_wells_import_batch ON sample_plate_wells(import_batch_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sample_plate_wells_active_position
ON sample_plate_wells(plate_id, well_code)
WHERE removed_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sample_plate_wells_active_sample
ON sample_plate_wells(sample_pk)
WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_private_patient_no ON participant_private_info(patient_no);
CREATE INDEX IF NOT EXISTS idx_private_id_card_hash ON participant_private_info(id_card_hash);
CREATE INDEX IF NOT EXISTS idx_private_phone_hash ON participant_private_info(phone_hash);

CREATE INDEX IF NOT EXISTS idx_raw_import_batch_id ON sample_raw_records(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_sample_import_items_batch ON sample_import_items(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_sample_import_items_sample ON sample_import_items(sample_pk);
CREATE INDEX IF NOT EXISTS idx_sample_import_items_code ON sample_import_items(sample_code);
CREATE INDEX IF NOT EXISTS idx_raw_data_gin ON sample_raw_records USING GIN(raw_data);
CREATE INDEX IF NOT EXISTS idx_raw_lab_results_gin ON sample_raw_records USING GIN(lab_results);

CREATE INDEX IF NOT EXISTS idx_genome_status_sample_code ON sample_genome_status(sample_code);
CREATE INDEX IF NOT EXISTS idx_genome_status_data_status ON sample_genome_status(genome_data_status);
CREATE INDEX IF NOT EXISTS idx_genome_status_final_status ON sample_genome_status(final_status);
CREATE INDEX IF NOT EXISTS idx_genome_status_import_batch ON sample_genome_status(import_batch_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_seq_project_sample_path
ON sequencing_data_records(project_code, sample_id, raw_data_path);
CREATE INDEX IF NOT EXISTS idx_seq_sample_id ON sequencing_data_records(sample_id);
CREATE INDEX IF NOT EXISTS idx_seq_sample_code ON sequencing_data_records(sample_code);
CREATE INDEX IF NOT EXISTS idx_seq_project_code ON sequencing_data_records(project_code);
CREATE INDEX IF NOT EXISTS idx_seq_data_status ON sequencing_data_records(data_status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_checkout_active_sample
ON sample_checkout_records(sample_pk)
WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS uq_return_pending_checkout
ON sample_return_records(checkout_record_id)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_movement_sample_pk ON sample_movement_logs(sample_pk);
CREATE INDEX IF NOT EXISTS idx_movement_sample_id ON sample_movement_logs(sample_id);
CREATE INDEX IF NOT EXISTS idx_movement_sample_code ON sample_movement_logs(sample_code);
CREATE INDEX IF NOT EXISTS idx_movement_action_type ON sample_movement_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_movement_created_at ON sample_movement_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_private_access_sample_pk ON private_info_access_logs(sample_pk);
CREATE INDEX IF NOT EXISTS idx_private_access_sample_id ON private_info_access_logs(sample_id);
CREATE INDEX IF NOT EXISTS idx_private_access_sample_code ON private_info_access_logs(sample_code);
CREATE INDEX IF NOT EXISTS idx_private_access_viewer_id ON private_info_access_logs(viewer_id);
CREATE INDEX IF NOT EXISTS idx_private_access_created_at ON private_info_access_logs(created_at);

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_districts_updated_at ON districts;
CREATE TRIGGER trg_districts_updated_at
BEFORE UPDATE ON districts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_centers_set_center_code ON centers;
CREATE TRIGGER trg_centers_set_center_code
BEFORE INSERT OR UPDATE OF district_code, hospital_seq ON centers
FOR EACH ROW EXECUTE FUNCTION set_center_code();

DROP TRIGGER IF EXISTS trg_centers_updated_at ON centers;
CREATE TRIGGER trg_centers_updated_at
BEFORE UPDATE ON centers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sample_import_batches_updated_at ON sample_import_batches;
CREATE TRIGGER trg_sample_import_batches_updated_at
BEFORE UPDATE ON sample_import_batches
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_hospital_upload_batches_updated_at ON hospital_upload_batches;
CREATE TRIGGER trg_hospital_upload_batches_updated_at
BEFORE UPDATE ON hospital_upload_batches
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_samples_set_sample_code ON samples;
CREATE TRIGGER trg_samples_set_sample_code
BEFORE INSERT OR UPDATE OF center_code, sample_seq ON samples
FOR EACH ROW EXECUTE FUNCTION set_sample_code();

DROP TRIGGER IF EXISTS trg_samples_updated_at ON samples;
CREATE TRIGGER trg_samples_updated_at
BEFORE UPDATE ON samples
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_private_info_updated_at ON participant_private_info;
CREATE TRIGGER trg_private_info_updated_at
BEFORE UPDATE ON participant_private_info
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sample_storage_updated_at ON sample_storage;
CREATE TRIGGER trg_sample_storage_updated_at
BEFORE UPDATE ON sample_storage
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sample_plates_updated_at ON sample_plates;
CREATE TRIGGER trg_sample_plates_updated_at
BEFORE UPDATE ON sample_plates
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sample_plate_wells_updated_at ON sample_plate_wells;
CREATE TRIGGER trg_sample_plate_wells_updated_at
BEFORE UPDATE ON sample_plate_wells
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_storage_freezers_updated_at ON storage_freezers;
CREATE TRIGGER trg_storage_freezers_updated_at
BEFORE UPDATE ON storage_freezers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sample_genome_status_updated_at ON sample_genome_status;
CREATE TRIGGER trg_sample_genome_status_updated_at
BEFORE UPDATE ON sample_genome_status
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_seq_data_updated_at ON sequencing_data_records;
CREATE TRIGGER trg_seq_data_updated_at
BEFORE UPDATE ON sequencing_data_records
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_checkout_updated_at ON sample_checkout_records;
CREATE TRIGGER trg_checkout_updated_at
BEFORE UPDATE ON sample_checkout_records
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_usage_updated_at ON sample_usage_records;
CREATE TRIGGER trg_usage_updated_at
BEFORE UPDATE ON sample_usage_records
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_return_updated_at ON sample_return_records;
CREATE TRIGGER trg_return_updated_at
BEFORE UPDATE ON sample_return_records
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO districts (district_code, district_name, city_name, province)
VALUES
    ('510104', '锦江区', '成都市', '四川'),
    ('510105', '青羊区', '成都市', '四川'),
    ('510106', '金牛区', '成都市', '四川'),
    ('510107', '武侯区', '成都市', '四川'),
    ('510108', '成华区', '成都市', '四川'),
    ('510112', '龙泉驿区', '成都市', '四川'),
    ('510113', '青白江区', '成都市', '四川'),
    ('510114', '新都区', '成都市', '四川'),
    ('510115', '温江区', '成都市', '四川'),
    ('510116', '双流区', '成都市', '四川'),
    ('510117', '郫都区', '成都市', '四川'),
    ('510118', '新津区', '成都市', '四川'),
    ('510302', '自流井区', '自贡市', '四川'),
    ('510303', '贡井区', '自贡市', '四川'),
    ('510304', '大安区', '自贡市', '四川'),
    ('510311', '沿滩区', '自贡市', '四川'),
    ('510402', '东区', '攀枝花市', '四川'),
    ('510403', '西区', '攀枝花市', '四川'),
    ('510404', '仁和区', '攀枝花市', '四川'),
    ('510421', '米易县', '攀枝花市', '四川'),
    ('510502', '江阳区', '泸州市', '四川'),
    ('510503', '纳溪区', '泸州市', '四川'),
    ('510504', '龙马潭区', '泸州市', '四川'),
    ('510521', '泸县', '泸州市', '四川'),
    ('510603', '旌阳区', '德阳市', '四川'),
    ('510604', '罗江区', '德阳市', '四川'),
    ('510703', '涪城区', '绵阳市', '四川'),
    ('510704', '游仙区', '绵阳市', '四川'),
    ('510705', '安州区', '绵阳市', '四川'),
    ('510802', '利州区', '广元市', '四川'),
    ('510811', '昭化区', '广元市', '四川'),
    ('510812', '朝天区', '广元市', '四川'),
    ('510903', '船山区', '遂宁市', '四川'),
    ('510904', '安居区', '遂宁市', '四川'),
    ('511002', '市中区', '内江市', '四川'),
    ('511011', '东兴区', '内江市', '四川'),
    ('511102', '市中区', '乐山市', '四川'),
    ('511111', '沙湾区', '乐山市', '四川'),
    ('511112', '五通桥区', '乐山市', '四川'),
    ('511113', '金口河区', '乐山市', '四川'),
    ('511302', '顺庆区', '南充市', '四川'),
    ('511303', '高坪区', '南充市', '四川'),
    ('511304', '嘉陵区', '南充市', '四川'),
    ('511402', '东坡区', '眉山市', '四川'),
    ('511403', '彭山区', '眉山市', '四川'),
    ('511502', '翠屏区', '宜宾市', '四川'),
    ('511503', '南溪区', '宜宾市', '四川'),
    ('511504', '叙州区', '宜宾市', '四川'),
    ('511602', '广安区', '广安市', '四川'),
    ('511603', '前锋区', '广安市', '四川'),
    ('511702', '通川区', '达州市', '四川'),
    ('511703', '达川区', '达州市', '四川'),
    ('511802', '雨城区', '雅安市', '四川'),
    ('511803', '名山区', '雅安市', '四川'),
    ('511902', '巴州区', '巴中市', '四川'),
    ('511903', '恩阳区', '巴中市', '四川'),
    ('512002', '雁江区', '资阳市', '四川'),
    ('512021', '安岳县', '资阳市', '四川'),
    ('513221', '汶川县', '阿坝藏族羌族自治州', '四川')
ON CONFLICT (district_code) DO UPDATE
SET district_name = EXCLUDED.district_name,
    city_name = EXCLUDED.city_name,
    province = EXCLUDED.province,
    is_active = true,
    updated_at = now();

WITH center_seed (district_code, hospital_seq, center_name) AS (
    VALUES
        ('510105', '001', '四川省人民医院'),
        ('510105', '002', '青羊区草堂社区卫生服务中心'),
        ('510107', '001', '四川省肿瘤医院'),
        ('510115', '001', '温江区人民医院'),
        ('513221', '001', '汶川县人民医院')
)
INSERT INTO centers (
    center_code,
    center_name,
    province,
    district_code,
    region,
    hospital_seq,
    is_active
)
SELECT
    seed.district_code || '-' || seed.hospital_seq,
    seed.center_name,
    district.province,
    seed.district_code,
    district.district_name,
    seed.hospital_seq,
    true
FROM center_seed seed
JOIN districts district
  ON district.district_code = seed.district_code
ON CONFLICT ON CONSTRAINT uq_centers_district_seq DO UPDATE
SET center_name = EXCLUDED.center_name,
    province = EXCLUDED.province,
    region = EXCLUDED.region,
    updated_at = now();

CREATE TABLE IF NOT EXISTS specimen_types (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(64) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    allow_batch_code BOOLEAN NOT NULL DEFAULT false,
    uses_plate_wells BOOLEAN NOT NULL DEFAULT false,
    code_suffix VARCHAR(1) NULL,
    code_rule_confirmed BOOLEAN NOT NULL DEFAULT false,
    sort_order INTEGER NOT NULL DEFAULT 0,
    note VARCHAR(255) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_specimen_types_name CHECK (name = btrim(name) AND name <> ''),
    CONSTRAINT ck_specimen_types_sort_order CHECK (sort_order >= 0),
    CONSTRAINT ck_specimen_types_code_suffix CHECK (
        code_suffix IS NULL OR code_suffix = '' OR code_suffix ~ '^[A-Za-z]$'
    ),
    CONSTRAINT ck_specimen_types_code_rule CHECK (
        (code_rule_confirmed = true AND code_suffix IS NOT NULL)
        OR (code_rule_confirmed = false AND code_suffix IS NULL)
    ),
    CONSTRAINT ck_specimen_types_batch_code_rule CHECK (
        allow_batch_code = false OR code_rule_confirmed = true
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_specimen_types_name_ci
ON specimen_types (lower(name));

CREATE UNIQUE INDEX IF NOT EXISTS uq_specimen_types_confirmed_suffix
ON specimen_types (code_suffix)
WHERE code_rule_confirmed = true;

DROP TRIGGER IF EXISTS trg_specimen_types_updated_at ON specimen_types;
CREATE TRIGGER trg_specimen_types_updated_at
BEFORE UPDATE ON specimen_types
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO specimen_types (
    name, is_active, allow_batch_code, uses_plate_wells,
    code_suffix, code_rule_confirmed, sort_order, note
)
VALUES
    ('全血', true, true, false, '', true, 10, '基础样本编码，不使用后缀。'),
    ('血清', true, true, false, 'S', true, 20, '正式编码使用独立基础流水末尾追加大写 S。'),
    ('血浆', true, false, false, NULL, false, 30, NULL),
    ('组织', true, false, false, NULL, false, 40, NULL),
    ('粪便', true, false, false, NULL, false, 50, NULL),
    ('DNA', true, true, true, 'd', true, 60, '正式编码使用基础样本编码末尾追加小写 d。'),
    ('RNA', true, false, false, NULL, false, 70, NULL),
    ('干粉', true, false, false, NULL, false, 80, NULL),
    ('类器官', true, false, false, 'L', true, 90, '正式编码使用基础样本编码末尾追加大写 L；暂不开放批量打码。')
ON CONFLICT (name) DO NOTHING;

INSERT INTO storage_freezers (freezer_code, temperature_c, is_active)
VALUES
    ('448-01', -40, true),
    ('448-02', -80, true),
    ('513-01', -40, true),
    ('513-02', 4, true)
ON CONFLICT (freezer_code) DO NOTHING;

COMMIT;
