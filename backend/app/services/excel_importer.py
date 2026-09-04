from __future__ import annotations

import csv
import hashlib
import json
import re
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.security import encrypt_private_text
from app.services.storage_freezers import build_freezer_label
from app.services.specimen_types import (
    get_active_specimen_type_names,
    get_confirmed_specimen_code_rules,
)
from app.services.sample_codes import (
    BASE_SPECIMEN_TYPE,
    DerivedSampleRule,
    parse_sample_code_parts,
)
from app.services.sample_relations import sync_sample_relations
from app.services.workbook_loader import load_excel_path

CORE_FIELD_MAP = {
    "序": "sample_id",
    "条码号": "barcode_no",
    "实验号": "experiment_no",
    "病人号": "patient_no",
    "来源": "source_batch",
    "民族": "ethnicity",
    "性别": "sex",
    "年龄": "age",
    "类型": "visit_type",
    "科室": "department",
    "床号": "bed_no",
    "申请医生": "doctor",
    "诊断": "diagnosis",
    "申请项目": "request_items",
    "实验情况": "test_priority",
    "标本": "specimen_type",
    "设备": "device",
    "采集时间": "collection_time",
    "接收时间": "received_time",
    "上机时间": "machine_time",
    "审核时间": "review_time",
    "备注": "note",
}

SAMPLE_ID_HEADERS = ("序", "原始序号", "医院样本号", "原始样本号", "样本号")
COLLECTION_TIME_HEADERS = ("采集时间", "采样时间", "采集日期", "采样日期")
SPECIMEN_TYPE_HEADERS = ("标本", "样本类型", "标本类型")

PRIVATE_FIELDS = {"姓名", "身份证号", "电话", "地址"}
TIME_COLUMNS = {"collection_time", "received_time", "machine_time", "review_time"}
LAB_START_HEADER = "WBC"
SAMPLE_ID_PATTERN = re.compile(r"^[0-9]{6}$")
CSV_SHEET_NAME = "CSV"
IMPORT_STATUSES = {"not_stored", "in_storage", "sequencing"}
SAMPLE_CODE_HEADERS = ("sample_code", "样本编码", "正式编码", "贴标编码")


def find_sample_code_headers(headers: list[str]) -> list[str]:
    return [header for header in headers if header in SAMPLE_CODE_HEADERS]


@dataclass(frozen=True)
class ExcelImportResult:
    import_batch_id: int
    total_rows: int
    success_rows: int
    failed_rows: int
    errors: list[dict[str, Any]]


class DuplicateSampleCodeError(ValueError):
    def __init__(self, duplicate_codes: list[str]):
        self.duplicate_codes = duplicate_codes
        preview = "、".join(duplicate_codes[:10])
        suffix = f" 等 {len(duplicate_codes)} 个" if len(duplicate_codes) > 10 else ""
        super().__init__(f"导入文件中有样本编码已存在：{preview}{suffix}")


class AtomicImportError(ValueError):
    def __init__(self, errors: list[dict[str, Any]]):
        self.errors = errors
        first_reason = errors[0]["reason"] if errors else "未知错误"
        super().__init__(f"整批导入已回滚：{first_reason}")


def resolve_import_batch_status(success_rows: int, failed_rows: int) -> str:
    if success_rows > 0 and failed_rows > 0:
        return "partial"
    if success_rows > 0:
        return "imported"
    return "failed"


def resolve_import_sample_status(
    existing_status: str | None,
    default_status: str,
) -> str:
    """Only apply the selected initial status when creating a new sample."""
    return existing_status or default_status


def normalize_text(value: Any) -> str | None:
    if value is None:
        return None
    text_value = str(value).strip()
    return text_value or None


def sha256_text(value: str | None) -> str | None:
    if not value:
        return None
    return hashlib.sha256(value.strip().encode("utf-8")).hexdigest()


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clean_sample_id(value: Any) -> str | None:
    text_value = normalize_text(value)
    if text_value is None:
        return None
    return text_value.replace("\n", "").replace("\r", "").replace("\t", "").strip()


def clean_sample_code(value: Any) -> str | None:
    text_value = normalize_text(value)
    if text_value is None:
        return None
    return text_value.replace("\n", "").replace("\r", "").replace("\t", "").strip()


def parse_sample_code(
    sample_code: str,
    code_rules: tuple[DerivedSampleRule, ...] | None = None,
) -> tuple[str, str] | None:
    parts = parse_sample_code_parts(sample_code, code_rules)
    if parts is None:
        return None
    return parts.center_code, parts.sample_seq


def parse_time(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    text_value = str(value).strip()
    if not text_value:
        return None
    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
        "%Y/%m/%d %H:%M:%S",
        "%Y/%m/%d %H:%M",
        "%Y/%m/%d",
        "%Y.%m.%d %H:%M:%S",
        "%Y.%m.%d %H:%M",
        "%Y.%m.%d",
    ):
        try:
            return datetime.strptime(text_value, fmt)
        except ValueError:
            pass
    return None


def json_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat(sep=" ")
    return value


def row_to_dict(headers: list[str], values: tuple[Any, ...]) -> dict[str, Any]:
    data: dict[str, Any] = {}
    for header, value in zip(headers, values, strict=False):
        if not header:
            continue
        data[header] = json_value(value)
    return data


def read_csv_rows(path: Path) -> tuple[list[str], list[tuple[Any, ...]]]:
    last_error: Exception | None = None
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            with path.open("r", encoding=encoding, newline="") as f:
                rows = list(csv.reader(f))
            if not rows:
                return [], []
            headers = [normalize_text(value) or "" for value in rows[0]]
            data_rows = [tuple(row) for row in rows[1:]]
            return headers, data_rows
        except UnicodeDecodeError as exc:
            last_error = exc
            continue
    raise ValueError(f"无法读取 CSV 文件编码：{last_error}")


def read_import_rows(path: Path, sheet_name: str) -> tuple[list[str], list[tuple[Any, ...]], str]:
    if path.suffix.lower() == ".csv":
        headers, rows = read_csv_rows(path)
        return headers, rows, CSV_SHEET_NAME

    wb = load_excel_path(path, data_only=True)
    try:
        if sheet_name not in wb.sheetnames:
            raise ValueError(f"工作表不存在：{sheet_name}")
        ws = wb[sheet_name]
        headers = [normalize_text(cell.value) or "" for cell in ws[1]]
        rows = [tuple(row) for row in ws.iter_rows(min_row=2, values_only=True)]
        return headers, rows, sheet_name
    finally:
        wb.close()


def build_payload(
    headers: list[str],
    row_values: tuple[Any, ...],
    row_number: int,
    allow_nonstandard: bool,
    require_sample_code: bool = False,
    code_rules: tuple[DerivedSampleRule, ...] | None = None,
) -> dict[str, Any]:
    raw_data = row_to_dict(headers, row_values)
    sample_id = next(
        (
            cleaned
            for header in SAMPLE_ID_HEADERS
            if (cleaned := clean_sample_id(raw_data.get(header)))
        ),
        None,
    )
    if not sample_id:
        raise ValueError(f"第 {row_number} 行：序为空")
    if not require_sample_code and not allow_nonstandard and not SAMPLE_ID_PATTERN.match(sample_id):
        raise ValueError(f"第 {row_number} 行：序不是 6 位数字字符串：{sample_id}")

    sample_code = None
    for header in SAMPLE_CODE_HEADERS:
        sample_code = clean_sample_code(raw_data.get(header))
        if sample_code:
            break
    if require_sample_code and not sample_code:
        raise ValueError(
            f"第 {row_number} 行：缺少样本编码列，请先在批量打码页面生成编码并写入 Excel"
        )
    if sample_code and parse_sample_code(sample_code, code_rules) is None:
        raise ValueError(f"第 {row_number} 行：样本编码格式不正确：{sample_code}")

    core: dict[str, Any] = {"sample_id": sample_id}
    for excel_name, column_name in CORE_FIELD_MAP.items():
        if column_name == "sample_id":
            continue
        value = raw_data.get(excel_name)
        if column_name in TIME_COLUMNS:
            core[column_name] = parse_time(value)
        else:
            core[column_name] = normalize_text(value)
    core["collection_time"] = next(
        (
            parsed
            for header in COLLECTION_TIME_HEADERS
            if (parsed := parse_time(raw_data.get(header))) is not None
        ),
        None,
    )
    core["specimen_type"] = next(
        (
            value
            for header in SPECIMEN_TYPE_HEADERS
            if (value := normalize_text(raw_data.get(header)))
        ),
        None,
    )
    if sample_code:
        code_parts = parse_sample_code_parts(sample_code, code_rules)
        if code_parts is not None:
            if code_parts.suffix is not None:
                core["specimen_type"] = code_parts.specimen_type
            elif not core.get("specimen_type"):
                core["specimen_type"] = BASE_SPECIMEN_TYPE

    private = {
        "name": normalize_text(raw_data.get("姓名")),
        "id_card_no": normalize_text(raw_data.get("身份证号")),
        "phone": normalize_text(raw_data.get("电话")),
        "address": normalize_text(raw_data.get("地址")),
    }

    lab_start_idx = headers.index(LAB_START_HEADER) if LAB_START_HEADER in headers else len(headers)
    lab_headers = set(headers[lab_start_idx:])

    visible_data: dict[str, Any] = {}
    lab_results: dict[str, Any] = {}
    ignored_fields: dict[str, Any] = {}
    known_core = (
        set(CORE_FIELD_MAP)
        | set(SAMPLE_CODE_HEADERS)
        | set(SAMPLE_ID_HEADERS)
        | set(COLLECTION_TIME_HEADERS)
        | set(SPECIMEN_TYPE_HEADERS)
    )

    for header, value in raw_data.items():
        if header.startswith("None.") or header == "":
            ignored_fields[header] = value
        elif header in PRIVATE_FIELDS or header in known_core:
            continue
        elif header in lab_headers:
            lab_results[header] = value
        else:
            visible_data[header] = value

    return {
        "sample_id": sample_id,
        "sample_code": sample_code,
        "core": core,
        "private": private,
        # Strongly sensitive fields are stored only in participant_private_info,
        # where their values are encrypted. Keeping the same plaintext values in
        # sample_raw_records.raw_data would otherwise bypass that protection.
        "raw_data": {
            header: value
            for header, value in raw_data.items()
            if header not in PRIVATE_FIELDS
        },
        "visible_data": visible_data,
        "lab_results": lab_results,
        "ignored_fields": ignored_fields,
    }


def import_excel_file(
    db: Session,
    path: Path,
    sheet_name: str,
    uploaded_by: int | None,
    allow_nonstandard: bool = False,
    original_file_name: str | None = None,
    center_code: str | None = None,
    default_status: str = "not_stored",
    code_date: date | None = None,
    require_sample_code: bool = False,
    freezer_no: str | None = None,
    shelf_no: str | None = None,
    box_no: str | None = None,
    storage_position: str | None = None,
    duplicate_strategy: str = "error",
    atomic: bool = False,
    commit: bool = True,
    sample_codes_by_row: dict[int, str] | None = None,
) -> ExcelImportResult:
    if not center_code and not require_sample_code:
        raise ValueError("请选择导入中心")
    if default_status not in IMPORT_STATUSES:
        raise ValueError("无效的样本初始状态")
    if duplicate_strategy not in {"error", "overwrite"}:
        raise ValueError("无效的重复样本处理方式")

    if center_code:
        center = db.execute(
            text(
                """
                SELECT center_code
                FROM centers
                WHERE center_code = :center_code AND is_active = true
                """
            ),
            {"center_code": center_code},
        ).mappings().first()
        if center is None:
            raise ValueError("导入中心不存在或已停用")

    allowed_specimen_types = get_active_specimen_type_names(db)
    code_rules = get_confirmed_specimen_code_rules(db)
    rule_by_type = {rule.specimen_type: rule for rule in code_rules}

    headers, data_rows, import_sheet_name = read_import_rows(path, sheet_name)
    if require_sample_code and sample_codes_by_row is None and not find_sample_code_headers(headers):
        raise ValueError("当前文件未发现样本编码列，请先在批量打码页面生成编码后再导入")
    total_rows = len(data_rows)
    display_file_name = original_file_name or path.name
    date_prefix = None
    next_serial = 1
    if not require_sample_code and sample_codes_by_row is None:
        code_date_value = code_date or datetime.now().date()
        date_prefix = code_date_value.strftime("%y%m%d")
        max_seq = db.execute(
            text(
                """
                SELECT max(substring(sample_seq FROM 7 FOR 4)::int)
                FROM samples
                WHERE center_code = :center_code
                  AND sample_seq LIKE :date_prefix
                  AND sample_seq ~ '^[0-9]{10}[A-Za-z]?$'
                """
            ),
            {"center_code": center_code, "date_prefix": f"{date_prefix}%"},
        ).scalar_one_or_none()
        next_serial = int(max_seq) + 1 if max_seq else 1
    storage_values = {
        "freezer_no": normalize_text(freezer_no),
        "shelf_no": normalize_text(shelf_no),
        "box_no": normalize_text(box_no),
        "storage_position": normalize_text(storage_position),
    }
    if storage_values["freezer_no"]:
        freezer = (
            db.execute(
                text(
                    """
                    SELECT freezer_code, temperature_c
                    FROM storage_freezers
                    WHERE freezer_code = :freezer_code
                      AND is_active = true
                    """
                ),
                {"freezer_code": storage_values["freezer_no"].upper()},
            )
            .mappings()
            .first()
        )
        if freezer is None:
            raise ValueError("冰箱不存在或已停用，请从冰箱下拉框重新选择")
        storage_values["freezer_no"] = build_freezer_label(
            freezer["freezer_code"],
            freezer["temperature_c"],
        )
    if storage_values["shelf_no"]:
        storage_values["shelf_no"] = storage_values["shelf_no"].upper()
        if not re.fullmatch(r"[IVXLCDM]+", storage_values["shelf_no"]):
            raise ValueError("冰箱层数请使用罗马数字，如 VI")
    if storage_values["box_no"] and not storage_values["box_no"].isdigit():
        raise ValueError("盒号必须使用数字")
    storage_location_parts = [
        storage_values["freezer_no"],
        f'{storage_values["shelf_no"]}层' if storage_values["shelf_no"] else None,
        f'{storage_values["box_no"]}号盒' if storage_values["box_no"] else None,
        storage_values["storage_position"],
    ]
    storage_location = " / ".join(
        value for value in storage_location_parts if value
    ) or None

    if duplicate_strategy == "error":
        file_codes: list[str] = []
        seen_file_codes: set[str] = set()
        original_next_serial = next_serial
        for row_number, row in enumerate(data_rows, start=2):
            if not any(value is not None and str(value).strip() for value in row):
                continue
            payload = build_payload(
                headers,
                row,
                row_number,
                allow_nonstandard,
                require_sample_code=require_sample_code,
                code_rules=code_rules,
            )
            specimen_type = payload["core"].get("specimen_type")
            if specimen_type not in allowed_specimen_types:
                raise ValueError(
                    f"第 {row_number} 行：样本类型为空、未启用或不存在：{specimen_type or '-'}"
                )
            row_sample_code = (
                sample_codes_by_row.get(row_number)
                if sample_codes_by_row is not None
                else payload["sample_code"]
            )
            if sample_codes_by_row is not None and not row_sample_code:
                raise ValueError(f"第 {row_number} 行：未生成正式样本编码")
            if row_sample_code:
                parsed_sample_code = parse_sample_code(row_sample_code, code_rules)
                if parsed_sample_code is None:
                    raise ValueError(f"第 {row_number} 行：样本编码格式不正确：{row_sample_code}")
                row_center_code, sample_seq = parsed_sample_code
                final_sample_code = f"{row_center_code}-{sample_seq}"
            else:
                if not center_code or not date_prefix:
                    raise ValueError(f"第 {row_number} 行：缺少样本编码")
                if next_serial > 9999:
                    raise ValueError(f"第 {row_number} 行：当天该中心流水号已超过 9999")
                suffix = rule_by_type.get(specimen_type)
                sample_seq = (
                    f"{date_prefix}{next_serial:04d}"
                    f"{suffix.suffix if suffix is not None else ''}"
                )
                next_serial += 1
                final_sample_code = f"{center_code}-{sample_seq}"
            if final_sample_code in seen_file_codes:
                raise ValueError(f"第 {row_number} 行：样本编码在 Excel 内重复：{final_sample_code}")
            seen_file_codes.add(final_sample_code)
            file_codes.append(final_sample_code)
        next_serial = original_next_serial

        if file_codes:
            duplicate_codes = [
                row["sample_code"]
                for row in db.execute(
                    text(
                        """
                        SELECT sample_code
                        FROM samples
                        WHERE is_deleted = false
                          AND sample_code = ANY(:sample_codes)
                        ORDER BY sample_code
                        """
                    ),
                    {"sample_codes": file_codes},
                ).mappings()
            ]
            if duplicate_codes:
                raise DuplicateSampleCodeError(duplicate_codes)

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
                'sample',
                'imported',
                CAST(:field_mapping AS jsonb)
            )
            RETURNING id
            """
        ),
        {
            "file_name": display_file_name,
            # The plaintext upload is processed from a short-lived directory.
            # Keep its name and SHA-256 for audit, not the expired local path.
            "file_path": None,
            "file_hash": file_hash(path),
            "uploaded_by": uploaded_by,
            "total_rows": total_rows,
            "field_mapping": json.dumps(CORE_FIELD_MAP, ensure_ascii=False),
        },
    ).scalar_one()

    success_rows = 0
    errors: list[dict[str, Any]] = []
    seen_codes: set[str] = set()
    center_active_cache: dict[str, bool] = {}

    for row_number, row in enumerate(data_rows, start=2):
        if not any(value is not None and str(value).strip() for value in row):
            continue
        row_transaction = db.begin_nested()
        try:
            payload = build_payload(
                headers,
                row,
                row_number,
                allow_nonstandard,
                require_sample_code=require_sample_code,
                code_rules=code_rules,
            )
            sample_id = payload["sample_id"]
            core = payload["core"]
            if core.get("specimen_type") not in allowed_specimen_types:
                raise ValueError(
                    f"第 {row_number} 行：样本类型为空、未启用或不存在：{core.get('specimen_type') or '-'}"
                )
            row_sample_code = (
                sample_codes_by_row.get(row_number)
                if sample_codes_by_row is not None
                else payload["sample_code"]
            )
            if sample_codes_by_row is not None and not row_sample_code:
                raise ValueError(f"第 {row_number} 行：未生成正式样本编码")
            if row_sample_code:
                parsed_sample_code = parse_sample_code(row_sample_code, code_rules)
                if parsed_sample_code is None:
                    raise ValueError(f"第 {row_number} 行：样本编码格式不正确：{row_sample_code}")
                row_center_code, sample_seq = parsed_sample_code
                if center_code and row_center_code != center_code:
                    raise ValueError(
                        f"第 {row_number} 行：样本编码中心 {row_center_code} 与导入中心 {center_code} 不一致"
                    )
                final_center_code = row_center_code
            else:
                if not center_code or not date_prefix:
                    raise ValueError(f"第 {row_number} 行：缺少样本编码")
                if next_serial > 9999:
                    raise ValueError(f"第 {row_number} 行：当天该中心流水号已超过 9999")
                suffix = rule_by_type.get(core.get("specimen_type"))
                sample_seq = (
                    f"{date_prefix}{next_serial:04d}"
                    f"{suffix.suffix if suffix is not None else ''}"
                )
                next_serial += 1
                final_center_code = center_code
            if final_center_code not in center_active_cache:
                center_active_cache[final_center_code] = (
                    db.execute(
                        text(
                            """
                            SELECT 1
                            FROM centers
                            WHERE center_code = :center_code AND is_active = true
                            """
                        ),
                        {"center_code": final_center_code},
                    ).scalar_one_or_none()
                    is not None
                )
            if not center_active_cache[final_center_code]:
                raise ValueError(f"第 {row_number} 行：样本编码中心不存在或已停用：{final_center_code}")
            final_sample_code = f"{final_center_code}-{sample_seq}"
            if final_sample_code in seen_codes:
                raise ValueError(f"第 {row_number} 行：样本编码在 Excel 内重复：{final_sample_code}")
            seen_codes.add(final_sample_code)

            existing_sample = (
                db.execute(
                    text(
                        """
                        SELECT id, sample_status
                        FROM samples
                        WHERE sample_code = :sample_code
                          AND is_deleted = false
                        FOR UPDATE
                        """
                    ),
                    {"sample_code": final_sample_code},
                )
                .mappings()
                .one_or_none()
            )

            conflict_action = (
                "DO NOTHING"
                if duplicate_strategy == "error"
                else """
                    DO UPDATE SET
                        sample_id = EXCLUDED.sample_id,
                        center_code = EXCLUDED.center_code,
                        sample_seq = EXCLUDED.sample_seq,
                        barcode_no = EXCLUDED.barcode_no,
                        experiment_no = EXCLUDED.experiment_no,
                        patient_no = EXCLUDED.patient_no,
                        source_batch = EXCLUDED.source_batch,
                        ethnicity = EXCLUDED.ethnicity,
                        sex = EXCLUDED.sex,
                        age = EXCLUDED.age,
                        visit_type = EXCLUDED.visit_type,
                        department = EXCLUDED.department,
                        bed_no = EXCLUDED.bed_no,
                        doctor = EXCLUDED.doctor,
                        diagnosis = EXCLUDED.diagnosis,
                        request_items = EXCLUDED.request_items,
                        test_priority = EXCLUDED.test_priority,
                        specimen_type = EXCLUDED.specimen_type,
                        device = EXCLUDED.device,
                        collection_time = EXCLUDED.collection_time,
                        received_time = EXCLUDED.received_time,
                        machine_time = EXCLUDED.machine_time,
                        review_time = EXCLUDED.review_time,
                        sample_status = EXCLUDED.sample_status,
                        storage_location = COALESCE(EXCLUDED.storage_location, samples.storage_location),
                        note = EXCLUDED.note
                """
            )
            sample_row = db.execute(
                text(
                    f"""
                    INSERT INTO samples (
                        sample_id, center_code, sample_seq, barcode_no, experiment_no, patient_no, source_batch,
                        ethnicity, sex, age, visit_type, department, bed_no, doctor,
                        diagnosis, request_items, test_priority, specimen_type, device,
                        collection_time, received_time, machine_time, review_time,
                        sample_status, storage_location, note
                    )
                    VALUES (
                        :sample_id, :center_code, :sample_seq, :barcode_no, :experiment_no, :patient_no,
                        :source_batch, :ethnicity, :sex, :age, :visit_type,
                        :department, :bed_no, :doctor, :diagnosis,
                        :request_items, :test_priority, :specimen_type, :device,
                        :collection_time, :received_time, :machine_time,
                        :review_time, :sample_status, :storage_location, :note
                    )
                    ON CONFLICT (sample_code)
                    WHERE is_deleted = false AND sample_code IS NOT NULL
                    {conflict_action}
                    RETURNING id, sample_id, sample_code
                    """
                ),
                {
                    **core,
                    "center_code": final_center_code,
                    "sample_seq": sample_seq,
                    "sample_status": resolve_import_sample_status(
                        existing_sample["sample_status"] if existing_sample is not None else None,
                        default_status,
                    ),
                    "storage_location": storage_location,
                },
            ).mappings().one_or_none()
            if sample_row is None:
                raise DuplicateSampleCodeError([final_sample_code])
            sample_pk = sample_row["id"]
            stored_sample_id = sample_row["sample_id"]

            private = payload["private"]
            db.execute(
                text(
                    """
                    INSERT INTO participant_private_info (
                        sample_pk, sample_id, patient_no, name_encrypted, id_card_no_encrypted,
                        id_card_hash, phone_encrypted, phone_hash, address_encrypted
                    )
                    VALUES (
                        :sample_pk, :sample_id, :patient_no, :name_encrypted, :id_card_no_encrypted,
                        :id_card_hash, :phone_encrypted, :phone_hash, :address_encrypted
                    )
                    ON CONFLICT (sample_pk) DO UPDATE SET
                        sample_id = EXCLUDED.sample_id,
                        patient_no = EXCLUDED.patient_no,
                        name_encrypted = EXCLUDED.name_encrypted,
                        id_card_no_encrypted = EXCLUDED.id_card_no_encrypted,
                        id_card_hash = EXCLUDED.id_card_hash,
                        phone_encrypted = EXCLUDED.phone_encrypted,
                        phone_hash = EXCLUDED.phone_hash,
                        address_encrypted = EXCLUDED.address_encrypted
                    """
                ),
                {
                    "sample_pk": sample_pk,
                    "sample_id": stored_sample_id,
                    "patient_no": core.get("patient_no"),
                    "name_encrypted": encrypt_private_text(private["name"]),
                    "id_card_no_encrypted": encrypt_private_text(private["id_card_no"]),
                    "id_card_hash": sha256_text(private["id_card_no"]),
                    "phone_encrypted": encrypt_private_text(private["phone"]),
                    "phone_hash": sha256_text(private["phone"]),
                    "address_encrypted": encrypt_private_text(private["address"]),
                },
            )

            db.execute(
                text(
                    """
                    INSERT INTO sample_raw_records (
                        sample_pk, sample_id, import_batch_id, source_file_name, sheet_name,
                        row_number, raw_data, visible_data, lab_results, ignored_fields
                    )
                    VALUES (
                        :sample_pk, :sample_id, :import_batch_id, :source_file_name, :sheet_name,
                        :row_number, CAST(:raw_data AS jsonb), CAST(:visible_data AS jsonb),
                        CAST(:lab_results AS jsonb), CAST(:ignored_fields AS jsonb)
                    )
                    ON CONFLICT (sample_pk) DO UPDATE SET
                        sample_id = EXCLUDED.sample_id,
                        import_batch_id = EXCLUDED.import_batch_id,
                        source_file_name = EXCLUDED.source_file_name,
                        sheet_name = EXCLUDED.sheet_name,
                        row_number = EXCLUDED.row_number,
                        raw_data = EXCLUDED.raw_data,
                        visible_data = EXCLUDED.visible_data,
                        lab_results = EXCLUDED.lab_results,
                        ignored_fields = EXCLUDED.ignored_fields
                    """
                ),
                {
                    "sample_pk": sample_pk,
                    "sample_id": stored_sample_id,
                    "import_batch_id": import_batch_id,
                    "source_file_name": display_file_name,
                    "sheet_name": import_sheet_name,
                    "row_number": row_number,
                    "raw_data": json.dumps(payload["raw_data"], ensure_ascii=False),
                    "visible_data": json.dumps(payload["visible_data"], ensure_ascii=False),
                    "lab_results": json.dumps(payload["lab_results"], ensure_ascii=False),
                    "ignored_fields": json.dumps(payload["ignored_fields"], ensure_ascii=False),
                },
            )
            if storage_location:
                db.execute(
                    text(
                        """
                        INSERT INTO sample_storage (
                            sample_pk,
                            sample_id,
                            freezer_no,
                            shelf_no,
                            box_no,
                            storage_position
                        )
                        VALUES (
                            :sample_pk,
                            :sample_id,
                            :freezer_no,
                            :shelf_no,
                            :box_no,
                            :storage_position
                        )
                        ON CONFLICT (sample_pk) DO UPDATE SET
                            sample_id = EXCLUDED.sample_id,
                            freezer_no = EXCLUDED.freezer_no,
                            shelf_no = EXCLUDED.shelf_no,
                            box_no = EXCLUDED.box_no,
                            storage_position = EXCLUDED.storage_position,
                            updated_at = now()
                        """
                    ),
                    {
                        "sample_pk": sample_pk,
                        "sample_id": stored_sample_id,
                        **storage_values,
                    },
                )
            db.execute(
                text(
                    """
                    INSERT INTO sample_import_items (
                        import_batch_id,
                        sample_pk,
                        sample_code,
                        row_number,
                        action_type
                    )
                    VALUES (
                        :import_batch_id,
                        :sample_pk,
                        :sample_code,
                        :row_number,
                        :action_type
                    )
                    ON CONFLICT (import_batch_id, sample_pk) DO NOTHING
                    """
                ),
                {
                    "import_batch_id": import_batch_id,
                    "sample_pk": sample_pk,
                    "sample_code": final_sample_code,
                    "row_number": row_number,
                    "action_type": "updated" if existing_sample is not None else "created",
                },
            )
            sync_sample_relations(
                db,
                sample_pk=sample_pk,
                sample_code=final_sample_code,
                operator_id=uploaded_by,
                code_rules=code_rules,
            )
            row_transaction.commit()
            success_rows += 1
        except Exception as exc:
            if row_transaction.is_active:
                row_transaction.rollback()
            row_data = row_to_dict(headers, row)
            errors.append(
                {
                    "row_number": row_number,
                    "sample_id": clean_sample_id(row_data.get("序")),
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
    else:
        db.flush()

    return ExcelImportResult(
        import_batch_id=import_batch_id,
        total_rows=total_rows,
        success_rows=success_rows,
        failed_rows=len(errors),
        errors=errors,
    )
