BEGIN;

-- Synchronize the current canonical center seed for existing databases.
--
-- This migration is intentionally safe to rerun:
-- - missing districts and centers are inserted;
-- - canonical names and district display fields are refreshed;
-- - centers created later through the management page are not deleted;
-- - an existing district or center's is_active flag is preserved.
--
-- It may also be rerun after an intentional cleanup of districts/centers.

INSERT INTO districts (
    district_code,
    district_name,
    city_name,
    province,
    is_active
)
VALUES
    ('510105', '青羊区', '成都市', '四川', true),
    ('510107', '武侯区', '成都市', '四川', true),
    ('510115', '温江区', '成都市', '四川', true),
    ('513221', '汶川县', '阿坝藏族羌族自治州', '四川', true)
ON CONFLICT (district_code) DO UPDATE
SET district_name = EXCLUDED.district_name,
    city_name = EXCLUDED.city_name,
    province = EXCLUDED.province,
    updated_at = now();

WITH center_seed (district_code, hospital_seq, center_name) AS (
    VALUES
        ('510105', '001', '四川省人民医院'),
        ('510105', '002', '青羊区草堂社区卫生服务中心'),
        ('510107', '001', '四川省肿瘤医院'),
        ('510115', '001', '温江区人民医院'),
        ('513221', '001', '汶川县人民医院')
)
INSERT INTO centers (
    center_code,
    center_name,
    province,
    district_code,
    region,
    hospital_seq,
    is_active
)
SELECT
    seed.district_code || '-' || seed.hospital_seq,
    seed.center_name,
    district.province,
    seed.district_code,
    district.district_name,
    seed.hospital_seq,
    true
FROM center_seed seed
JOIN districts district
  ON district.district_code = seed.district_code
ON CONFLICT ON CONSTRAINT uq_centers_district_seq DO UPDATE
SET center_name = EXCLUDED.center_name,
    province = EXCLUDED.province,
    region = EXCLUDED.region,
    updated_at = now();

COMMIT;
