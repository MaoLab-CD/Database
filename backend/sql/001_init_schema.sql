BEGIN;

CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    password_changed_at TIMESTAMPTZ NULL,
    password_reset_required BOOLEAN NOT NULL DEFAULT false,
    display_name VARCHAR(64) NOT NULL,
    role VARCHAR(20) NOT NULL,
    is_super_admin BOOLEAN NOT NULL DEFAULT false,
    permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    last_login_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_users_role CHECK (role IN ('admin', 'user')),
    CONSTRAINT ck_users_status CHECK (status IN ('active', 'disabled'))
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
    status VARCHAR(32) NOT NULL,
    error_report JSONB NOT NULL DEFAULT '[]'::jsonb,
    field_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_import_batch_status CHECK (status IN ('previewed', 'imported', 'failed', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS samples (
    id BIGSERIAL PRIMARY KEY,
    sample_id VARCHAR(32) NOT NULL,
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
    sample_status VARCHAR(32) NOT NULL DEFAULT 'in_storage',
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
    ))
);

CREATE INDEX IF NOT EXISTS idx_samples_barcode_no ON samples(barcode_no);
CREATE INDEX IF NOT EXISTS idx_samples_patient_no ON samples(patient_no);
CREATE INDEX IF NOT EXISTS idx_samples_ethnicity ON samples(ethnicity);
CREATE INDEX IF NOT EXISTS idx_samples_status ON samples(sample_status);
CREATE INDEX IF NOT EXISTS idx_samples_sequencing_status ON samples(sequencing_status);
CREATE INDEX IF NOT EXISTS idx_samples_collection_time ON samples(collection_time);

CREATE TABLE IF NOT EXISTS participant_private_info (
    id BIGSERIAL PRIMARY KEY,
    sample_pk BIGINT NOT NULL UNIQUE REFERENCES samples(id) ON DELETE CASCADE,
    sample_id VARCHAR(32) NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_private_patient_no ON participant_private_info(patient_no);
CREATE INDEX IF NOT EXISTS idx_private_id_card_hash ON participant_private_info(id_card_hash);
CREATE INDEX IF NOT EXISTS idx_private_phone_hash ON participant_private_info(phone_hash);

CREATE TABLE IF NOT EXISTS sample_raw_records (
    id BIGSERIAL PRIMARY KEY,
    sample_pk BIGINT NOT NULL UNIQUE REFERENCES samples(id) ON DELETE CASCADE,
    sample_id VARCHAR(32) NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_raw_import_batch_id ON sample_raw_records(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_raw_data_gin ON sample_raw_records USING GIN(raw_data);
CREATE INDEX IF NOT EXISTS idx_raw_lab_results_gin ON sample_raw_records USING GIN(lab_results);

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

CREATE UNIQUE INDEX IF NOT EXISTS uq_seq_project_sample_path
ON sequencing_data_records(project_code, sample_id, raw_data_path);

CREATE INDEX IF NOT EXISTS idx_seq_sample_id ON sequencing_data_records(sample_id);
CREATE INDEX IF NOT EXISTS idx_seq_project_code ON sequencing_data_records(project_code);
CREATE INDEX IF NOT EXISTS idx_seq_data_status ON sequencing_data_records(data_status);

CREATE TABLE IF NOT EXISTS sample_checkout_records (
    id BIGSERIAL PRIMARY KEY,
    sample_pk BIGINT NOT NULL REFERENCES samples(id),
    sample_id VARCHAR(32) NOT NULL,
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_checkout_active_sample
ON sample_checkout_records(sample_pk)
WHERE status = 'active';

CREATE TABLE IF NOT EXISTS sample_usage_records (
    id BIGSERIAL PRIMARY KEY,
    sample_pk BIGINT NOT NULL REFERENCES samples(id),
    sample_id VARCHAR(32) NOT NULL,
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
    sample_id VARCHAR(32) NOT NULL,
    checkout_record_id BIGINT NOT NULL REFERENCES sample_checkout_records(id),
    returned_by BIGINT NOT NULL REFERENCES users(id),
    return_requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_by BIGINT NULL REFERENCES users(id),
    confirmed_at TIMESTAMPTZ NULL,
    used_amount VARCHAR(64) NULL,
    unit VARCHAR(32) NULL,
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_return_pending_checkout
ON sample_return_records(checkout_record_id)
WHERE status = 'pending';

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

CREATE INDEX IF NOT EXISTS idx_movement_sample_pk ON sample_movement_logs(sample_pk);
CREATE INDEX IF NOT EXISTS idx_movement_sample_id ON sample_movement_logs(sample_id);
CREATE INDEX IF NOT EXISTS idx_movement_sample_code ON sample_movement_logs(sample_code);
CREATE INDEX IF NOT EXISTS idx_movement_action_type ON sample_movement_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_movement_created_at ON sample_movement_logs(created_at);

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

CREATE INDEX IF NOT EXISTS idx_private_access_sample_pk ON private_info_access_logs(sample_pk);
CREATE INDEX IF NOT EXISTS idx_private_access_sample_id ON private_info_access_logs(sample_id);
CREATE INDEX IF NOT EXISTS idx_private_access_sample_code ON private_info_access_logs(sample_code);
CREATE INDEX IF NOT EXISTS idx_private_access_viewer_id ON private_info_access_logs(viewer_id);
CREATE INDEX IF NOT EXISTS idx_private_access_created_at ON private_info_access_logs(created_at);

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

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sample_import_batches_updated_at ON sample_import_batches;
CREATE TRIGGER trg_sample_import_batches_updated_at
BEFORE UPDATE ON sample_import_batches
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_samples_updated_at ON samples;
CREATE TRIGGER trg_samples_updated_at
BEFORE UPDATE ON samples
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_private_info_updated_at ON participant_private_info;
CREATE TRIGGER trg_private_info_updated_at
BEFORE UPDATE ON participant_private_info
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

COMMIT;
