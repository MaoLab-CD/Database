from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.excel_importer import (
    SAMPLE_CODE_HEADERS,
    file_hash,
    normalize_text,
    parse_sample_code,
    read_import_rows,
    row_to_dict,
)
from app.services.storage_freezers import build_freezer_label
from app.services.sample_codes import DerivedSampleRule, parse_sample_code_parts
from app.services.sample_relations import sync_sample_relations
from app.services.specimen_types import get_confirmed_specimen_code_rules


SAMPLE_ID_HEADERS = ("序", "样本序号", "sample_id")
BARCODE_HEADERS = ("条码号", "barcode_no")
EXPERIMENT_HEADERS = ("实验号", "实验样本编号Novo ID", "experiment_no")
SOURCE_HEADERS = ("来源", "source_batch")
ALIQUOT_HEADERS = ("分装编号", "aliquot_no")
PLATE_CODE_HEADERS = (
    "样本板号Sample Plate Number",
    "样本板号Sample Plate*",
    "样本板号",
    "板号",
    "plate_code",
)
WELL_CODE_HEADERS = (
    "样本孔号Sample Well Number",
    "样本孔号Sample Well*",
    "样本孔号",
    "孔位",
    "well_code",
)
DNA_STATUS_VALUES = {"not_stored", "in_storage"}
PLATE_CODE_PATTERN = re.compile(r"^[0-9A-Za-z_-]{3,128}$")
WELL_CODE_PATTERN = re.compile(r"^[A-H](0[1-9]|1[0-2])$")


@dataclass(frozen=True)
class DnaPlateRow:
    row_number: int
    sample_id: str
    sample_code: str
    barcode_no: str | None
    experiment_no: str | None
    source_batch: str | None
    aliquot_no: str | None
    plate_code: str
    well_code: str
    action: str = "new"
    message: str | None = None


@dataclass(frozen=True)
class DnaPlatePreview:
    total_rows: int
    valid_rows: int
    error_rows: int
    new_rows: int
    existing_rows: int
    plate_count: int
    can_import: bool
    rows: list[dict[str, Any]]
    errors: list[dict[str, Any]]


@dataclass(frozen=True)
class DnaPlateImportResult:
    import_batch_id: int
    total_rows: int
    success_rows: int
    failed_rows: int
    errors: list[dict[str, Any]]


def _first_value(data: dict[str, Any], aliases: tuple[str, ...]) -> str | None:
    for alias in aliases:
        value = normalize_text(data.get(alias))
        if value:
            return value
    return None


def _require_headers(headers: list[str]) -> None:
    required_groups = {
        "样本序号": SAMPLE_ID_HEADERS,
        "sample_code": SAMPLE_CODE_HEADERS,
        "板号": PLATE_CODE_HEADERS,
        "孔位": WELL_CODE_HEADERS,
    }
    missing = [
        label
        for label, aliases in required_groups.items()
        if not any(alias in headers for alias in aliases)
    ]
    if missing:
        raise ValueError(f"缺少必需列：{'、'.join(missing)}")


def _parse_rows(
    path: Path,
    sheet_name: str,
    code_rules: tuple[DerivedSampleRule, ...] | None = None,
) -> tuple[list[DnaPlateRow], list[dict[str, Any]]]:
    headers, data_rows, _ = read_import_rows(path, sheet_name)
    _require_headers(headers)

    parsed_rows: list[DnaPlateRow] = []
    errors: list[dict[str, Any]] = []
    seen_codes: set[str] = set()
    seen_positions: set[tuple[str, str]] = set()

    for row_number, values in enumerate(data_rows, start=2):
        if not any(value is not None and str(value).strip() for value in values):
            continue
        data = row_to_dict(headers, values)
        sample_id = _first_value(data, SAMPLE_ID_HEADERS)
        sample_code = _first_value(data, SAMPLE_CODE_HEADERS)
        plate_code = (_first_value(data, PLATE_CODE_HEADERS) or "").upper()
        well_code = (_first_value(data, WELL_CODE_HEADERS) or "").upper()

        row_errors: list[str] = []
        if not sample_id:
            row_errors.append("样本序号为空")
        parsed_code = parse_sample_code_parts(sample_code or "", code_rules)
        if parsed_code is None or parsed_code.specimen_type != "DNA":
            row_errors.append("sample_code 必须是以小写 d 结尾的正式 DNA 编码")
        if not PLATE_CODE_PATTERN.fullmatch(plate_code):
            row_errors.append("板号为空或格式不正确")
        if not WELL_CODE_PATTERN.fullmatch(well_code):
            row_errors.append("孔位必须为 A01-H12")
        if sample_code and sample_code in seen_codes:
            row_errors.append("sample_code 在文件内重复")
        position = (plate_code, well_code)
        if plate_code and well_code and position in seen_positions:
            row_errors.append("板号与孔位组合在文件内重复")

        if row_errors:
            errors.append(
                {
                    "row_number": row_number,
                    "sample_id": sample_code or sample_id,
                    "reason": "；".join(row_errors),
                }
            )
            continue

        seen_codes.add(sample_code)
        seen_positions.add(position)
        parsed_rows.append(
            DnaPlateRow(
                row_number=row_number,
                sample_id=sample_id,
                sample_code=sample_code,
                barcode_no=_first_value(data, BARCODE_HEADERS),
                experiment_no=_first_value(data, EXPERIMENT_HEADERS),
                source_batch=_first_value(data, SOURCE_HEADERS),
                aliquot_no=_first_value(data, ALIQUOT_HEADERS),
                plate_code=plate_code,
                well_code=well_code,
            )
        )

    return parsed_rows, errors


def preview_dna_plate_file(db: Session, path: Path, sheet_name: str) -> DnaPlatePreview:
    code_rules = get_confirmed_specimen_code_rules(db, active_only=False)
    rows, errors = _parse_rows(path, sheet_name, code_rules)
    if not rows and not errors:
        raise ValueError("工作表没有可导入的数据")
    source_row_count = len(rows) + len(errors)

    sample_codes = [row.sample_code for row in rows]
    plate_codes = sorted({row.plate_code for row in rows})
    center_codes = sorted(
        {
            parsed[0]
            for row in rows
            if (parsed := parse_sample_code(row.sample_code, code_rules)) is not None
        }
    )
    active_centers = set(
        db.execute(
            text(
                """
                SELECT center_code
                FROM centers
                WHERE center_code = ANY(:center_codes)
                  AND is_active = true
                """
            ),
            {"center_codes": center_codes or [""]},
        ).scalars()
    )
    existing_samples = {
        row["sample_code"]: dict(row)
        for row in db.execute(
            text(
                """
                SELECT s.id,
                       s.sample_code,
                       s.specimen_type,
                       s.sample_status,
                       p.plate_code,
                       w.well_code
                FROM samples s
                LEFT JOIN sample_plate_wells w
                  ON w.sample_pk = s.id
                 AND w.removed_at IS NULL
                LEFT JOIN sample_plates p ON p.id = w.plate_id
                WHERE s.is_deleted = false
                  AND s.sample_code = ANY(:sample_codes)
                """
            ),
            {"sample_codes": sample_codes or [""]},
        ).mappings()
    }
    occupied_positions = {
        (row["plate_code"], row["well_code"]): dict(row)
        for row in db.execute(
            text(
                """
                SELECT p.plate_code,
                       w.well_code,
                       s.sample_code
                FROM sample_plate_wells w
                JOIN sample_plates p ON p.id = w.plate_id
                JOIN samples s
                  ON s.id = w.sample_pk
                 AND s.is_deleted = false
                WHERE w.removed_at IS NULL
                  AND p.plate_code = ANY(:plate_codes)
                """
            ),
            {"plate_codes": plate_codes or [""]},
        ).mappings()
    }

    checked_rows: list[DnaPlateRow] = []
    existing_count = 0
    for row in rows:
        existing = existing_samples.get(row.sample_code)
        occupied = occupied_positions.get((row.plate_code, row.well_code))
        row_errors: list[str] = []
        row_center_code = (
            parse_sample_code(row.sample_code, code_rules) or ("", "")
        )[0]
        if row_center_code not in active_centers:
            row_errors.append(f"样本中心不存在或已停用：{row_center_code}")
        if existing and existing["sample_status"] not in {
            "not_stored",
            "sequencing",
            "in_storage",
        }:
            row_errors.append(
                f"该 DNA 当前状态为 {existing['sample_status']}，不能通过板位导入覆盖"
            )
        if existing and existing["plate_code"] and (
            existing["plate_code"] != row.plate_code
            or existing["well_code"] != row.well_code
        ):
            row_errors.append(
                f"该 DNA 已位于 {existing['plate_code']}/{existing['well_code']}"
            )
        if occupied and occupied["sample_code"] != row.sample_code:
            row_errors.append(f"该孔位已被 {occupied['sample_code']} 占用")

        if row_errors:
            errors.append(
                {
                    "row_number": row.row_number,
                    "sample_id": row.sample_code,
                    "reason": "；".join(row_errors),
                }
            )
            checked_rows.append(
                DnaPlateRow(**{**asdict(row), "action": "error", "message": "；".join(row_errors)})
            )
        elif existing:
            existing_count += 1
            checked_rows.append(
                DnaPlateRow(
                    **{
                        **asdict(row),
                        "action": "existing",
                        "message": "更新已有 DNA 样本及板位",
                    }
                )
            )
        else:
            checked_rows.append(
                DnaPlateRow(
                    **{**asdict(row), "action": "new", "message": "新建 DNA 样本并写入板位"}
                )
            )

    valid_rows = sum(row.action != "error" for row in checked_rows)
    return DnaPlatePreview(
        total_rows=source_row_count,
        valid_rows=valid_rows,
        error_rows=len(errors),
        new_rows=sum(row.action == "new" for row in checked_rows),
        existing_rows=existing_count,
        plate_count=len(plate_codes),
        can_import=valid_rows > 0 and not errors,
        rows=[asdict(row) for row in checked_rows],
        errors=errors,
    )


def import_dna_plate_file(
    db: Session,
    path: Path,
    sheet_name: str,
    uploaded_by: int,
    original_file_name: str,
    default_status: str = "in_storage",
    freezer_code: str | None = None,
    layer_no: str | None = None,
    container_no: str | None = None,
) -> DnaPlateImportResult:
    if default_status not in DNA_STATUS_VALUES:
        raise ValueError("DNA 板位导入的初始状态只能是未入库或在库")

    preview = preview_dna_plate_file(db, path, sheet_name)
    if not preview.can_import:
        first_errors = "；".join(error["reason"] for error in preview.errors[:3])
        raise ValueError(f"预览校验未通过：{first_errors}")
    code_rules = get_confirmed_specimen_code_rules(db, active_only=False)

    freezer_id: int | None = None
    freezer_label: str | None = None
    normalized_freezer_code = normalize_text(freezer_code)
    if normalized_freezer_code:
        freezer = (
            db.execute(
                text(
                    """
                    SELECT id, freezer_code, temperature_c
                    FROM storage_freezers
                    WHERE freezer_code = :freezer_code
                      AND is_active = true
                    """
                ),
                {"freezer_code": normalized_freezer_code.upper()},
            )
            .mappings()
            .first()
        )
        if freezer is None:
            raise ValueError("冰箱不存在或已停用")
        freezer_id = freezer["id"]
        freezer_label = build_freezer_label(freezer["freezer_code"], freezer["temperature_c"])

    normalized_layer = normalize_text(layer_no)
    if normalized_layer:
        normalized_layer = normalized_layer.upper()
        if not re.fullmatch(r"[IVXLCDM]+", normalized_layer):
            raise ValueError("冰箱层数请使用罗马数字")
    normalized_container = normalize_text(container_no)
    if normalized_container and not normalized_container.isdigit():
        raise ValueError("盒号必须使用数字")

    batch_id = db.execute(
        text(
            """
            INSERT INTO sample_import_batches (
                file_name, file_path, file_hash, uploaded_by, total_rows,
                import_type, status, field_mapping
            )
            VALUES (
                :file_name, :file_path, :file_hash, :uploaded_by, :total_rows,
                'dna_plate', 'imported', CAST(:field_mapping AS jsonb)
            )
            RETURNING id
            """
        ),
        {
            "file_name": original_file_name,
            "file_path": None,
            "file_hash": file_hash(path),
            "uploaded_by": uploaded_by,
            "total_rows": preview.total_rows,
            "field_mapping": json.dumps(
                {
                    "sample_code": list(SAMPLE_CODE_HEADERS),
                    "plate_code": list(PLATE_CODE_HEADERS),
                    "well_code": list(WELL_CODE_HEADERS),
                },
                ensure_ascii=False,
            ),
        },
    ).scalar_one()

    plate_ids: dict[str, int] = {}
    for plate_code in sorted({row["plate_code"] for row in preview.rows}):
        plate_ids[plate_code] = db.execute(
            text(
                """
                INSERT INTO sample_plates (
                    plate_code, freezer_id, layer_no, container_no,
                    created_by, updated_by
                )
                VALUES (
                    :plate_code, :freezer_id, :layer_no, :container_no,
                    :operator_id, :operator_id
                )
                ON CONFLICT (plate_code) DO UPDATE SET
                    freezer_id = COALESCE(EXCLUDED.freezer_id, sample_plates.freezer_id),
                    layer_no = COALESCE(EXCLUDED.layer_no, sample_plates.layer_no),
                    container_no = COALESCE(EXCLUDED.container_no, sample_plates.container_no),
                    location_note = NULL,
                    updated_by = EXCLUDED.updated_by,
                    updated_at = now()
                RETURNING id
                """
            ),
            {
                "plate_code": plate_code,
                "freezer_id": freezer_id,
                "layer_no": normalized_layer,
                "container_no": normalized_container,
                "operator_id": uploaded_by,
            },
        ).scalar_one()

    success_rows = 0
    for row in preview.rows:
        center_code, sample_seq = parse_sample_code(
            row["sample_code"],
            code_rules,
        ) or (None, None)
        location_parts = [
            freezer_label,
            f"{normalized_layer}层" if normalized_layer else None,
            f"{normalized_container}号盒" if normalized_container else None,
            row["plate_code"],
            row["well_code"],
        ]
        storage_location = " / ".join(part for part in location_parts if part)
        existing_sample_pk = db.execute(
            text(
                """
                SELECT id
                FROM samples
                WHERE sample_code = :sample_code
                  AND is_deleted = false
                """
            ),
            {"sample_code": row["sample_code"]},
        ).scalar_one_or_none()
        sample_pk = db.execute(
            text(
                """
                INSERT INTO samples (
                    sample_id, center_code, sample_seq, barcode_no, experiment_no,
                    source_batch, specimen_type, sample_status, storage_location,
                    note, created_by, updated_by
                )
                VALUES (
                    :sample_id, :center_code, :sample_seq, :barcode_no, :experiment_no,
                    :source_batch, 'DNA', :sample_status, :storage_location,
                    NULL, :operator_id, :operator_id
                )
                ON CONFLICT (sample_code)
                WHERE is_deleted = false AND sample_code IS NOT NULL
                DO UPDATE SET
                    sample_id = EXCLUDED.sample_id,
                    barcode_no = EXCLUDED.barcode_no,
                    experiment_no = EXCLUDED.experiment_no,
                    source_batch = EXCLUDED.source_batch,
                    specimen_type = 'DNA',
                    sample_status = EXCLUDED.sample_status,
                    storage_location = EXCLUDED.storage_location,
                    note = NULL,
                    updated_by = EXCLUDED.updated_by,
                    updated_at = now()
                RETURNING id
                """
            ),
            {
                **row,
                "center_code": center_code,
                "sample_seq": sample_seq,
                "sample_status": default_status,
                "storage_location": storage_location,
                "operator_id": uploaded_by,
            },
        ).scalar_one()

        active_well_id = db.execute(
            text(
                """
                SELECT id
                FROM sample_plate_wells
                WHERE sample_pk = :sample_pk
                  AND removed_at IS NULL
                """
            ),
            {"sample_pk": sample_pk},
        ).scalar_one_or_none()
        if active_well_id is None:
            db.execute(
                text(
                    """
                    INSERT INTO sample_plate_wells (
                        plate_id, well_code, sample_pk, import_batch_id, placed_by
                    )
                    VALUES (
                        :plate_id, :well_code, :sample_pk, :import_batch_id, :placed_by
                    )
                    """
                ),
                {
                    "plate_id": plate_ids[row["plate_code"]],
                    "well_code": row["well_code"],
                    "sample_pk": sample_pk,
                    "import_batch_id": batch_id,
                    "placed_by": uploaded_by,
                },
            )
        else:
            db.execute(
                text(
                    """
                    UPDATE sample_plate_wells
                    SET import_batch_id = :import_batch_id,
                        note = NULL,
                        updated_at = now()
                    WHERE id = :well_id
                    """
                ),
                {"import_batch_id": batch_id, "well_id": active_well_id},
            )

        db.execute(
            text(
                """
                INSERT INTO sample_import_items (
                    import_batch_id, sample_pk, sample_code, row_number, action_type
                )
                VALUES (
                    :import_batch_id, :sample_pk, :sample_code, :row_number, :action_type
                )
                """
            ),
            {
                "import_batch_id": batch_id,
                "sample_pk": sample_pk,
                "sample_code": row["sample_code"],
                "row_number": row["row_number"],
                "action_type": "updated" if existing_sample_pk is not None else "created",
            },
        )
        sync_sample_relations(
            db,
            sample_pk=sample_pk,
            sample_code=row["sample_code"],
            operator_id=uploaded_by,
            code_rules=code_rules,
        )
        success_rows += 1

    db.execute(
        text(
            """
            UPDATE sample_import_batches
            SET success_rows = :success_rows,
                failed_rows = 0,
                updated_at = now()
            WHERE id = :batch_id
            """
        ),
        {"success_rows": success_rows, "batch_id": batch_id},
    )
    db.commit()
    return DnaPlateImportResult(
        import_batch_id=batch_id,
        total_rows=preview.total_rows,
        success_rows=success_rows,
        failed_rows=0,
        errors=[],
    )
