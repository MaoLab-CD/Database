BEGIN;

-- Clear sample/test/runtime data before the first formal import.
--
-- Explicitly preserved account/dictionary tables:
-- - users
-- - districts
-- - centers
-- - storage_freezers
-- - user_center_scopes (hospital account to center binding)
-- - hospital_upload_batches / hospital_upload_events and encrypted upload files
-- - secure_documents / secure_document_events and encrypted PDF files
-- - database_backup_records
--
-- Run this when you want to re-import samples and re-scan sequencing data
-- without losing accounts, permissions, centers, freezers, or account-center scopes.
-- This is destructive and cannot be undone without a backup. SQL cannot safely
-- remove encrypted files from disk, so the script refuses to run once an upload
-- batch or secure document exists. Use an application-level cleanup/rebinding
-- process instead; never delete only the database metadata for stored files.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM secure_documents LIMIT 1) THEN
        RAISE EXCEPTION
            'Refusing cleanup: secure_documents contains records. Preserve/rebind the attached PDF files first.';
    END IF;
    IF EXISTS (SELECT 1 FROM hospital_upload_batches LIMIT 1) THEN
        RAISE EXCEPTION
            'Refusing cleanup: hospital_upload_batches contains records. Preserve/reconcile encrypted upload files first.';
    END IF;
END
$$;

TRUNCATE TABLE
    auth_login_rate_limits,
    private_info_access_logs,
    sample_movement_logs,
    sample_return_records,
    sample_usage_records,
    sample_checkout_records,
    sample_plate_wells,
    sample_relations,
    sample_plates,
    sample_storage,
    sample_genome_status,
    participant_private_info,
    sample_raw_records,
    sequencing_data_records,
    sequencing_scan_batches,
    sample_import_items,
    sample_import_batches,
    samples
RESTART IDENTITY;

COMMIT;

-- Expected result after a successful cleanup: all counts below are zero.
SELECT 'samples' AS table_name, count(*) AS row_count FROM samples
UNION ALL SELECT 'sample_plates', count(*) FROM sample_plates
UNION ALL SELECT 'sample_import_batches', count(*) FROM sample_import_batches
UNION ALL SELECT 'sequencing_data_records', count(*) FROM sequencing_data_records
UNION ALL SELECT 'private_info_access_logs', count(*) FROM private_info_access_logs
UNION ALL SELECT 'auth_login_rate_limits', count(*) FROM auth_login_rate_limits
ORDER BY table_name;

-- Preserved configuration counts are shown for confirmation and must not be zeroed by this script.
SELECT 'users' AS table_name, count(*) AS row_count FROM users
UNION ALL SELECT 'districts', count(*) FROM districts
UNION ALL SELECT 'centers', count(*) FROM centers
UNION ALL SELECT 'storage_freezers', count(*) FROM storage_freezers
UNION ALL SELECT 'user_center_scopes', count(*) FROM user_center_scopes
UNION ALL SELECT 'hospital_upload_batches', count(*) FROM hospital_upload_batches
UNION ALL SELECT 'secure_documents', count(*) FROM secure_documents
UNION ALL SELECT 'database_backup_records', count(*) FROM database_backup_records
ORDER BY table_name;
