BEGIN;

-- Incremented whenever credentials or security-sensitive account state changes.
-- JWTs carry the version present at login; older versions are rejected.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_users_token_version'
          AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT ck_users_token_version CHECK (token_version >= 0);
    END IF;
END
$$;

COMMIT;
