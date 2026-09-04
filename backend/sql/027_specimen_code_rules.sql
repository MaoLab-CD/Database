BEGIN;

ALTER TABLE specimen_types
    ADD COLUMN IF NOT EXISTS code_suffix VARCHAR(1) NULL;

ALTER TABLE specimen_types
    ADD COLUMN IF NOT EXISTS code_rule_confirmed BOOLEAN NOT NULL DEFAULT false;

UPDATE specimen_types
SET code_suffix = CASE name
        WHEN '全血' THEN ''
        WHEN 'DNA' THEN 'd'
        WHEN '类器官' THEN 'L'
        WHEN '血清' THEN 'S'
        ELSE NULL
    END,
    code_rule_confirmed = name IN ('全血', 'DNA', '类器官', '血清'),
    allow_batch_code = CASE
        WHEN name IN ('全血', 'DNA', '血清') THEN true
        ELSE false
    END,
    note = CASE
        WHEN name = '血清' THEN '正式编码使用独立基础流水末尾追加大写 S。'
        ELSE note
    END,
    updated_at = now();

ALTER TABLE specimen_types
    DROP CONSTRAINT IF EXISTS ck_specimen_types_code_suffix;

ALTER TABLE specimen_types
    ADD CONSTRAINT ck_specimen_types_code_suffix
    CHECK (code_suffix IS NULL OR code_suffix = '' OR code_suffix ~ '^[A-Za-z]$');

ALTER TABLE specimen_types
    DROP CONSTRAINT IF EXISTS ck_specimen_types_code_rule;

ALTER TABLE specimen_types
    ADD CONSTRAINT ck_specimen_types_code_rule
    CHECK (
        (code_rule_confirmed = true AND code_suffix IS NOT NULL)
        OR (code_rule_confirmed = false AND code_suffix IS NULL)
    );

ALTER TABLE specimen_types
    DROP CONSTRAINT IF EXISTS ck_specimen_types_batch_code_rule;

ALTER TABLE specimen_types
    ADD CONSTRAINT ck_specimen_types_batch_code_rule
    CHECK (allow_batch_code = false OR code_rule_confirmed = true);

CREATE UNIQUE INDEX IF NOT EXISTS uq_specimen_types_confirmed_suffix
ON specimen_types (code_suffix)
WHERE code_rule_confirmed = true;

ALTER TABLE samples
    DROP CONSTRAINT IF EXISTS ck_samples_sample_seq_format;

ALTER TABLE samples
    DROP CONSTRAINT IF EXISTS ck_samples_sample_code_format;

ALTER TABLE samples
    ADD CONSTRAINT ck_samples_sample_seq_format
    CHECK (sample_seq IS NULL OR sample_seq ~ '^[0-9]{10}[A-Za-z]?$');

ALTER TABLE samples
    ADD CONSTRAINT ck_samples_sample_code_format
    CHECK (sample_code IS NULL OR sample_code ~ '^[0-9]{6}-[0-9]{3}-[0-9]{10}[A-Za-z]?$');

COMMIT;
