from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.excel_importer import (
    AtomicImportError,
    file_hash,
    normalize_text,
    parse_time,
    read_import_rows,
    resolve_import_batch_status,
)


SAMPLE_CODE_HEADERS = ("sample_code", "样本编码", "正式编码", "贴标编码")

FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "sample_code": SAMPLE_CODE_HEADERS,
    "genome_data_status": ("genome_data_status", "基因组数据状态", "基因组状态"),
    "data_type": ("data_type", "数据类型"),
    "sequencing_company": ("sequencing_company", "测序公司", "公司"),
    "sequencing_platform": ("sequencing_platform", "测序平台", "平台"),
    "sequencing_instrument": ("sequencing_instrument", "测序仪器", "仪器"),
    "sequencing_returned_at": ("sequencing_returned_at", "回库时间", "测序回库时间", "返回时间"),
    "sequencing_depth": ("sequencing_depth", "测序深度", "depth"),
    "genome_qc": ("genome_qc", "基因组QC", "基因组 QC", "QC", "qc"),
    "final_status": ("final_status", "最终状态", "最终可用状态"),
    "missing_reason": ("missing_reason", "不可用原因", "缺失原因"),
}


@dataclass(frozen=True)
class GenomeImportResult:
    import_batch_id: int
    total_rows: int
    success_rows: int
    failed_rows: int
    return_updated_rows: int
    return_skipped_rows: int
    errors: list[dict[str, Any]]


class DuplicateGenomeStatusError(ValueError):
    def __init__(self, duplicate_codes: list[str]):
        self.duplicate_codes = duplicate_codes
        preview = "、".join(duplicate_codes[:10])
        suffix = f" 等 {len(duplicate_codes)} 个" if len(duplicate_codes) > 10 else ""
        super().__init__(f"导入文件中已有基因组信息记录：{preview}{suffix}")


def clean_cell(value: Any) -> str | None:
    text_value = normalize_text(value)
    if text_value is None:
        return None
    return text_value.replace("\n", "").replace("\r", "").replace("\t", "").strip() or None


def build_header_index(headers: list[str]) -> dict[str, int]:
    return {header: index for index, header in enumerate(headers) if header}


def resolve_field_mapping(headers: list[str]) -> dict[str, str]:
    header_index = build_header_index(headers)
    mapping: dict[str, str] = {}
    for field_name, aliases in FIELD_ALIASES.items():
        for alias in aliases:
            if alias in header_index:
                mapping[field_name] = alias
                break
    return mapping


def get_row_value(
    row: tuple[Any, ...],
    headers: list[str],
    field_mapping: dict[str, str],
    field_name: str,
) -> Any:
    header = field_mapping.get(field_name)
    if not header:
        return None
    try:
        index = headers.index(header)
    except ValueError:
        return None
    if index >= len(row):
        return None
    return row[index]


def parse_optional_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    return parse_time(value)


def import_genome_info_file(
    db: Session,
    path: Path,
    sheet_name: str,
    uploaded_by: int | None,
    original_file_name: str | None = None,
    default_company: str | None = None,
    default_platform: str | None = None,
    default_instrument: str | None = None,
    default_returned_at: datetime | None = None,
    sync_return: bool = True,
    duplicate_strategy: str = "error",
    atomic: bool = False,
    commit: bool = True,
) -> GenomeImportResult:
    if duplicate_strategy not in {"error", "overwrite"}:
        raise ValueError("无效的重复基因组信息处理方式")

    headers, rows, import_sheet_name = read_import_rows(path, sheet_name)
    field_mapping = resolve_field_mapping(headers)
    if "sample_code" not in field_mapping:
        raise ValueError("当前文件未发现 sample_code / 样本编码 / 正式编码 / 贴标编码列")

    display_file_name = original_file_name or path.name
    total_rows = len(rows)
    existing_genome_codes: set[str] = set()
    file_codes: list[str] = []
    seen_codes: set[str] = set()
    for row_number, row in enumerate(rows, start=2):
        if not any(value is not None and str(value).strip() for value in row):
            continue
        sample_code = clean_cell(get_row_value(row, headers, field_mapping, "sample_code"))
        if not sample_code:
            continue
        if sample_code in seen_codes:
            raise ValueError(f"第 {row_number} 行：样本编码在 Excel 内重复：{sample_code}")
        seen_codes.add(sample_code)
        file_codes.append(sample_code)

    if file_codes:
        existing_genome_codes = {
            row[0]
            for row in db.execute(
                text(
                    """
                    SELECT sample_code
                    FROM sample_genome_status
                    WHERE sample_code = ANY(:sample_codes)
                    ORDER BY sample_code
                    """
                ),
                {"sample_codes": file_codes},
            ).all()
        }
        if duplicate_strategy == "error" and existing_genome_codes:
            raise DuplicateGenomeStatusError(sorted(existing_genome_codes))

    import_batch_id = db.execute(
        text(
            """
            INSERT INTO sample_import_batches (
                file_name,
                file_path,
                file_hash,
                uploaded_by,
                total_rows,
                import_type,
                status,
                field_mapping
            )
            VALUES (
                :file_name,
                :file_path,
                :file_hash,
                :uploaded_by,
                :total_rows,
                'genome',
                'imported',
                CAST(:field_mapping AS jsonb)
            )
            RETURNING id
            """
        ),
        {
            "file_name": display_file_name,
            "file_path": None,
            "file_hash": file_hash(path),
            "uploaded_by": uploaded_by,
            "total_rows": total_rows,
            "field_mapping": json.dumps(field_mapping, ensure_ascii=False),
        },
    ).scalar_one()

    success_rows = 0
    return_updated_rows = 0
    return_skipped_rows = 0
    errors: list[dict[str, Any]] = []

    for row_number, row in enumerate(rows, start=2):
        if not any(value is not None and str(value).strip() for value in row):
            continue

        sample_code = clean_cell(get_row_value(row, headers, field_mapping, "sample_code"))
        row_transaction = db.begin_nested()
        try:
            if not sample_code:
                raise ValueError("缺少样本编码")

            sample = (
                db.execute(
                    text(
                        """
                        SELECT id, sample_id, sample_code, sample_status, storage_location
                        FROM samples
                        WHERE sample_code = :sample_code
                          AND is_deleted = false
                        """
                    ),
                    {"sample_code": sample_code},
                )
                .mappings()
                .first()
            )
            if sample is None:
                raise ValueError("未找到对应样本")

            returned_at = parse_optional_datetime(
                get_row_value(row, headers, field_mapping, "sequencing_returned_at")
            ) or default_returned_at

            payload = {
                "sample_pk": sample["id"],
                "sample_id": sample["sample_id"],
                "sample_code": sample["sample_code"],
                "genome_data_status": clean_cell(
                    get_row_value(row, headers, field_mapping, "genome_data_status")
                ),
                "data_type": clean_cell(get_row_value(row, headers, field_mapping, "data_type")),
                "sequencing_company": clean_cell(
                    get_row_value(row, headers, field_mapping, "sequencing_company")
                )
                or clean_cell(default_company),
                "sequencing_platform": clean_cell(
                    get_row_value(row, headers, field_mapping, "sequencing_platform")
                )
                or clean_cell(default_platform),
                "sequencing_instrument": clean_cell(
                    get_row_value(row, headers, field_mapping, "sequencing_instrument")
                )
                or clean_cell(default_instrument),
                "sequencing_returned_at": returned_at,
                "sequencing_depth": clean_cell(
                    get_row_value(row, headers, field_mapping, "sequencing_depth")
                ),
                "genome_qc": clean_cell(get_row_value(row, headers, field_mapping, "genome_qc")),
                "final_status": clean_cell(get_row_value(row, headers, field_mapping, "final_status")),
                "missing_reason": clean_cell(get_row_value(row, headers, field_mapping, "missing_reason")),
                "source_file_name": display_file_name,
                "sheet_name": import_sheet_name,
                "row_number": row_number,
                "import_batch_id": import_batch_id,
            }

            db.execute(
                text(
                    """
                    INSERT INTO sample_genome_status (
                        sample_pk,
                        sample_id,
                        sample_code,
                        genome_data_status,
                        data_type,
                        sequencing_company,
                        sequencing_platform,
                        sequencing_instrument,
                        sequencing_returned_at,
                        sequencing_depth,
                        genome_qc,
                        final_status,
                        missing_reason,
                        source_file_name,
                        sheet_name,
                        row_number,
                        import_batch_id
                    )
                    VALUES (
                        :sample_pk,
                        :sample_id,
                        :sample_code,
                        :genome_data_status,
                        :data_type,
                        :sequencing_company,
                        :sequencing_platform,
                        :sequencing_instrument,
                        :sequencing_returned_at,
                        :sequencing_depth,
                        :genome_qc,
                        :final_status,
                        :missing_reason,
                        :source_file_name,
                        :sheet_name,
                        :row_number,
                        :import_batch_id
                    )
                    ON CONFLICT (sample_pk) DO UPDATE SET
                        sample_id = EXCLUDED.sample_id,
                        sample_code = EXCLUDED.sample_code,
                        genome_data_status = EXCLUDED.genome_data_status,
                        data_type = EXCLUDED.data_type,
                        sequencing_company = EXCLUDED.sequencing_company,
                        sequencing_platform = EXCLUDED.sequencing_platform,
                        sequencing_instrument = EXCLUDED.sequencing_instrument,
                        sequencing_returned_at = EXCLUDED.sequencing_returned_at,
                        sequencing_depth = EXCLUDED.sequencing_depth,
                        genome_qc = EXCLUDED.genome_qc,
                        final_status = EXCLUDED.final_status,
                        missing_reason = EXCLUDED.missing_reason,
                        source_file_name = EXCLUDED.source_file_name,
                        sheet_name = EXCLUDED.sheet_name,
                        row_number = EXCLUDED.row_number,
                        import_batch_id = EXCLUDED.import_batch_id,
                        updated_at = now()
                    """
                ),
                payload,
            )

            if sync_return:
                if sample["sample_status"] == "sequencing":
                    db.execute(
                        text(
                            """
                            UPDATE samples
                            SET sample_status = 'in_storage',
                                current_holder_id = NULL,
                                updated_by = :updated_by,
                                updated_at = now()
                            WHERE id = :sample_pk
                            """
                        ),
                        {"sample_pk": sample["id"], "updated_by": uploaded_by},
                    )
                    db.execute(
                        text(
                            """
                            INSERT INTO sample_movement_logs (
                                sample_pk,
                                sample_id,
                                sample_code,
                                action_type,
                                before_status,
                                after_status,
                                after_location,
                                operator_id,
                                operator_role,
                                related_record_id,
                                detail,
                                note
                            )
                            VALUES (
                                :sample_pk,
                                :sample_id,
                                :sample_code,
                                'sequencing_return',
                                'sequencing',
                                'in_storage',
                                :after_location,
                                :operator_id,
                                'admin',
                                :related_record_id,
                                CAST(:detail AS jsonb),
                                :note
                            )
                            """
                        ),
                        {
                            "sample_pk": sample["id"],
                            "sample_id": sample["sample_id"],
                            "sample_code": sample["sample_code"],
                            "after_location": sample["storage_location"],
                            "operator_id": uploaded_by,
                            "related_record_id": import_batch_id,
                            "detail": json.dumps(
                                {
                                    "source": "genome_info_import",
                                    "source_file_name": display_file_name,
                                    "row_number": row_number,
                                },
                                ensure_ascii=False,
                            ),
                            "note": "基因组信息导入时同步回库",
                        },
                    )
                    return_updated_rows += 1
                else:
                    return_skipped_rows += 1

            row_transaction.commit()
            success_rows += 1
        except Exception as exc:
            if row_transaction.is_active:
                row_transaction.rollback()
            errors.append(
                {
                    "row_number": row_number,
                    "sample_id": sample_code,
                    "reason": str(exc),
                }
            )
            if atomic:
                raise AtomicImportError(errors) from exc

    status_value = resolve_import_batch_status(success_rows, len(errors))
    db.execute(
        text(
            """
            UPDATE sample_import_batches
            SET success_rows = :success_rows,
                failed_rows = :failed_rows,
                status = :status,
                error_report = CAST(:error_report AS jsonb),
                updated_at = now()
            WHERE id = :import_batch_id
            """
        ),
        {
            "success_rows": success_rows,
            "failed_rows": len(errors),
            "status": status_value,
            "error_report": json.dumps(errors, ensure_ascii=False),
            "import_batch_id": import_batch_id,
        },
    )
    if commit:
        db.commit()

    return GenomeImportResult(
        import_batch_id=import_batch_id,
        total_rows=total_rows,
        success_rows=success_rows,
        failed_rows=len(errors),
        return_updated_rows=return_updated_rows,
        return_skipped_rows=return_skipped_rows,
        errors=errors,
    )
