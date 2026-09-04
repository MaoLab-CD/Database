BEGIN;

-- 测序数据记录表加 sample_code 字段
-- 测序公司返回的数据目录以旧 sample_id 命名，
-- 这里将系统自定义编码 sample_code 写入测序记录，便于展示和关联

ALTER TABLE sequencing_data_records
    ADD COLUMN IF NOT EXISTS sample_code VARCHAR(128);

-- 回填已有记录：按 sample_id / barcode_no 匹配 samples 表的 sample_code
UPDATE sequencing_data_records r
SET sample_code = s.sample_code
FROM samples s
WHERE r.sample_code IS NULL
  AND s.is_deleted = false
  AND (
    s.sample_code = r.sample_id
    OR s.sample_id = r.sample_id
    OR s.barcode_no = r.sample_id
  );

CREATE INDEX IF NOT EXISTS idx_seq_sample_code ON sequencing_data_records(sample_code);

COMMIT;
