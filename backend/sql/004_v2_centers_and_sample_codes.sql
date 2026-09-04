BEGIN;

-- V2 phase 1: district / center dictionaries and external sample codes.
-- This migration is intentionally non-destructive:
-- - Child tables should reference samples(id). sample_id is kept only as the
--   original source id from Excel.
-- - Existing rows are not backfilled automatically. Real deployment is expected
--   to clear test data and re-import with center_code/sample_seq/sample_code.

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

CREATE INDEX IF NOT EXISTS idx_centers_district_code ON centers(district_code);
CREATE INDEX IF NOT EXISTS idx_centers_is_active ON centers(is_active);

-- Keep center_code derived from district_code + hospital_seq for all future writes.
CREATE OR REPLACE FUNCTION set_center_code()
RETURNS TRIGGER AS $$
BEGIN
    NEW.center_code := NEW.district_code || '-' || NEW.hospital_seq;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_centers_set_center_code ON centers;
CREATE TRIGGER trg_centers_set_center_code
BEFORE INSERT OR UPDATE OF district_code, hospital_seq ON centers
FOR EACH ROW EXECUTE FUNCTION set_center_code();

-- Ensure the shared updated_at helper exists even if this migration is run alone.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_districts_updated_at ON districts;
CREATE TRIGGER trg_districts_updated_at
BEFORE UPDATE ON districts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_centers_updated_at ON centers;
CREATE TRIGGER trg_centers_updated_at
BEFORE UPDATE ON centers
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
    ('512021', '安岳县', '资阳市', '四川')
ON CONFLICT (district_code) DO UPDATE
SET district_name = EXCLUDED.district_name,
    city_name = EXCLUDED.city_name,
    province = EXCLUDED.province,
    is_active = true,
    updated_at = now();

-- Only county/district-level codes are selectable for centers.
DELETE FROM districts d
WHERE right(d.district_code, 2) = '00'
  AND NOT EXISTS (
      SELECT 1
      FROM centers c
      WHERE c.district_code = d.district_code
  );

-- Historical initial center seed. Keep this migration immutable after release.
-- The current rerunnable center snapshot is maintained by
-- 016_center_seed_sync.sql and schema_latest.sql.
INSERT INTO centers (center_code, center_name, province, district_code, region, hospital_seq)
VALUES
    ('510105-001', '四川省人民医院', '四川', '510105', '青羊区', '001'),
    ('510105-002', '青羊区草堂社区卫生服务中心', '四川', '510105', '青羊区', '002'),
    ('510115-001', '温江区人民医院', '四川', '510115', '温江区', '001')
ON CONFLICT (center_code) DO UPDATE
SET center_name = EXCLUDED.center_name,
    province = EXCLUDED.province,
    district_code = EXCLUDED.district_code,
    region = EXCLUDED.region,
    hospital_seq = EXCLUDED.hospital_seq,
    is_active = true,
    updated_at = now();

ALTER TABLE samples
    ADD COLUMN IF NOT EXISTS center_code VARCHAR(64) NULL REFERENCES centers(center_code),
    ADD COLUMN IF NOT EXISTS sample_seq VARCHAR(16) NULL,
    ADD COLUMN IF NOT EXISTS sample_code VARCHAR(128) NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_samples_sample_seq_format'
          AND conrelid = 'samples'::regclass
    ) THEN
        ALTER TABLE samples
            ADD CONSTRAINT ck_samples_sample_seq_format
            CHECK (sample_seq IS NULL OR sample_seq ~ '^[0-9]{10}d?$');
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_samples_code_format'
          AND conrelid = 'samples'::regclass
    ) THEN
        ALTER TABLE samples
            ADD CONSTRAINT ck_samples_code_format
            CHECK (sample_code IS NULL OR sample_code ~ '^[0-9]{6}-[0-9]{3}-[0-9]{10}d?$');
    END IF;
END $$;

CREATE OR REPLACE FUNCTION set_sample_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.center_code IS NOT NULL AND NEW.sample_seq IS NOT NULL THEN
        NEW.sample_code := NEW.center_code || '-' || NEW.sample_seq;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_samples_set_sample_code ON samples;
CREATE TRIGGER trg_samples_set_sample_code
BEFORE INSERT OR UPDATE OF center_code, sample_seq ON samples
FOR EACH ROW EXECUTE FUNCTION set_sample_code();

CREATE UNIQUE INDEX IF NOT EXISTS uq_samples_center_seq
ON samples(center_code, sample_seq)
WHERE is_deleted = false AND center_code IS NOT NULL AND sample_seq IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_samples_code
ON samples(sample_code)
WHERE is_deleted = false AND sample_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_samples_center_code ON samples(center_code);
CREATE INDEX IF NOT EXISTS idx_samples_sample_seq ON samples(sample_seq);

COMMIT;
