BEGIN;

-- Existing hospital accounts may have inherited ordinary-user permissions
-- before the upload-only policy was finalized. Normalize them first.
UPDATE users
SET role = 'user',
    is_super_admin = false,
    permissions = '{"hospital_data_submit": true}'::jsonb,
    updated_at = now()
WHERE account_type = 'hospital'
  AND (
      role <> 'user'
      OR is_super_admin
      OR permissions <> '{"hospital_data_submit": true}'::jsonb
  );

ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_hospital_upload_only;
ALTER TABLE users ADD CONSTRAINT ck_users_hospital_upload_only
CHECK (
    account_type <> 'hospital'
    OR (
        role = 'user'
        AND is_super_admin = false
        AND permissions = '{"hospital_data_submit": true}'::jsonb
    )
);

COMMIT;
