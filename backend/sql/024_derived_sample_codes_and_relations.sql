BEGIN;

ALTER TABLE samples
    DROP CONSTRAINT IF EXISTS ck_samples_sample_seq_format;

ALTER TABLE samples
    DROP CONSTRAINT IF EXISTS ck_samples_sample_code_format;

ALTER TABLE samples
    ADD CONSTRAINT ck_samples_sample_seq_format
    CHECK (sample_seq IS NULL OR sample_seq ~ '^[0-9]{10}(d|L)?$');

ALTER TABLE samples
    ADD CONSTRAINT ck_samples_sample_code_format
    CHECK (sample_code IS NULL OR sample_code ~ '^[0-9]{6}-[0-9]{3}-[0-9]{10}(d|L)?$');

INSERT INTO specimen_types (
    name, is_active, allow_batch_code, uses_plate_wells, sort_order, note
)
VALUES (
    '类器官', true, false, false, 90,
    '正式编码使用基础样本编码末尾追加大写 L；暂不开放批量打码。'
)
ON CONFLICT (name) DO UPDATE
SET note = EXCLUDED.note,
    updated_at = now();

-- Existing databases may already contain both sides. Backfill without changing
-- sample records; future imports keep these relations synchronized in app code.
INSERT INTO sample_relations (
    parent_sample_pk, child_sample_pk, relation_type, created_by
)
SELECT parent.id, child.id, 'dna_extraction', NULL
FROM samples child
JOIN samples parent
  ON parent.sample_code = left(child.sample_code, length(child.sample_code) - 1)
 AND parent.is_deleted = false
WHERE child.is_deleted = false
  AND child.sample_code ~ 'd$'
ON CONFLICT DO NOTHING;

INSERT INTO sample_relations (
    parent_sample_pk, child_sample_pk, relation_type, created_by
)
SELECT parent.id, child.id, 'organoid_derivation', NULL
FROM samples child
JOIN samples parent
  ON parent.sample_code = left(child.sample_code, length(child.sample_code) - 1)
 AND parent.is_deleted = false
WHERE child.is_deleted = false
  AND child.sample_code ~ 'L$'
ON CONFLICT DO NOTHING;

COMMIT;
