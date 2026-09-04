BEGIN;

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

COMMIT;
