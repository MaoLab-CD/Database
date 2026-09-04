BEGIN;

CREATE TABLE IF NOT EXISTS sample_plates (
    id BIGSERIAL PRIMARY KEY,
    plate_code VARCHAR(128) NOT NULL UNIQUE,
    plate_type VARCHAR(32) NOT NULL DEFAULT '96_well',
    row_count INTEGER NOT NULL DEFAULT 8,
    column_count INTEGER NOT NULL DEFAULT 12,
    freezer_id BIGINT NULL REFERENCES storage_freezers(id),
    layer_no VARCHAR(64) NULL,
    container_no VARCHAR(64) NULL,
    location_note TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by BIGINT NULL REFERENCES users(id),
    updated_by BIGINT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_sample_plates_type CHECK (plate_type IN ('96_well')),
    CONSTRAINT ck_sample_plates_dimensions CHECK (
        row_count BETWEEN 1 AND 26
        AND column_count BETWEEN 1 AND 99
    )
);

CREATE TABLE IF NOT EXISTS sample_relations (
    id BIGSERIAL PRIMARY KEY,
    parent_sample_pk BIGINT NOT NULL REFERENCES samples(id),
    child_sample_pk BIGINT NOT NULL REFERENCES samples(id),
    relation_type VARCHAR(32) NOT NULL,
    created_by BIGINT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_sample_relations_distinct_samples CHECK (
        parent_sample_pk <> child_sample_pk
    ),
    CONSTRAINT uq_sample_relations_pair UNIQUE (
        parent_sample_pk,
        child_sample_pk,
        relation_type
    ),
    CONSTRAINT uq_sample_relations_child_type UNIQUE (
        child_sample_pk,
        relation_type
    )
);

CREATE TABLE IF NOT EXISTS sample_plate_wells (
    id BIGSERIAL PRIMARY KEY,
    plate_id BIGINT NOT NULL REFERENCES sample_plates(id),
    well_code VARCHAR(8) NOT NULL,
    sample_pk BIGINT NOT NULL REFERENCES samples(id),
    import_batch_id BIGINT NULL REFERENCES sample_import_batches(id),
    placed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    placed_by BIGINT NULL REFERENCES users(id),
    removed_at TIMESTAMPTZ NULL,
    removed_by BIGINT NULL REFERENCES users(id),
    note TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_sample_plate_wells_code CHECK (
        well_code ~ '^[A-Z](0[1-9]|[1-9][0-9])$'
    ),
    CONSTRAINT ck_sample_plate_wells_removed_after_placed CHECK (
        removed_at IS NULL OR removed_at >= placed_at
    )
);

CREATE INDEX IF NOT EXISTS idx_sample_plates_freezer
ON sample_plates(freezer_id);

CREATE INDEX IF NOT EXISTS idx_sample_relations_parent
ON sample_relations(parent_sample_pk);

CREATE INDEX IF NOT EXISTS idx_sample_relations_child
ON sample_relations(child_sample_pk);

CREATE INDEX IF NOT EXISTS idx_sample_plate_wells_plate
ON sample_plate_wells(plate_id);

CREATE INDEX IF NOT EXISTS idx_sample_plate_wells_sample
ON sample_plate_wells(sample_pk);

CREATE INDEX IF NOT EXISTS idx_sample_plate_wells_import_batch
ON sample_plate_wells(import_batch_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sample_plate_wells_active_position
ON sample_plate_wells(plate_id, well_code)
WHERE removed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sample_plate_wells_active_sample
ON sample_plate_wells(sample_pk)
WHERE removed_at IS NULL;

DROP TRIGGER IF EXISTS trg_sample_plates_updated_at ON sample_plates;
CREATE TRIGGER trg_sample_plates_updated_at
BEFORE UPDATE ON sample_plates
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sample_plate_wells_updated_at ON sample_plate_wells;
CREATE TRIGGER trg_sample_plate_wells_updated_at
BEFORE UPDATE ON sample_plate_wells
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
