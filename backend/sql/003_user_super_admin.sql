BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;

UPDATE users
SET is_super_admin = true,
    role = 'admin',
    status = 'active',
    updated_at = now()
WHERE username = 'maolab';

COMMIT;
