from __future__ import annotations

import csv
import json
import logging
import re
from contextlib import contextmanager
from io import StringIO
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Iterator

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.db.session import get_db
from app.services.login_rate_limit import client_ip_from_request
from app.services.excel_importer import (
    AtomicImportError,
    DuplicateSampleCodeError,
    find_sample_code_headers,
    import_excel_file,
    parse_sample_code,
)
from app.services.sample_codes import parse_sample_code_parts
from app.services.specimen_types import get_confirmed_specimen_code_rules
from app.services.dna_plate_importer import (
    import_dna_plate_file,
    preview_dna_plate_file,
)
from app.services.genome_importer import DuplicateGenomeStatusError, import_genome_info_file
from app.services.hospital_uploads import MAX_UPLOAD_BYTES, inspect_hospital_upload_file
from app.services.workbook_loader import load_excel_workbook

router = APIRouter()
logger = logging.getLogger(__name__)

ALLOWED_SUFFIXES = {".xls", ".xlsx", ".xlsm", ".csv"}
EXCEL_SUFFIXES = {".xls", ".xlsx", ".xlsm"}
CSV_SHEET_NAME = "CSV"
IMPORT_TEMP_DIR = Path(__file__).resolve().parents[3] / "uploads" / "imports" / "tmp"


async def read_limited_upload(file: UploadFile) -> bytes:
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="上传文件为空")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="文件不能超过 20 MB")
    return content


@contextmanager
def temporary_import_file(content: bytes, suffix: str) -> Iterator[Path]:
    IMPORT_TEMP_DIR.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix="sample_admin_import_", dir=IMPORT_TEMP_DIR) as temp_dir:
        path = Path(temp_dir) / f"upload{suffix}"
        path.write_bytes(content)
        inspect_hospital_upload_file(path)
        yield path


class ImportBatchItem(BaseModel):
    id: int
    file_name: str
    file_path: str | None = None
    uploaded_by: int | None = None
    uploaded_by_name: str | None = None
    uploaded_at: datetime
    total_rows: int
    success_rows: int
    failed_rows: int
    import_type: str = "sample"
    status: str
    created_count: int = 0
    updated_count: int = 0
    removed_count: int = 0
    pending_storage_count: int = 0
    created_at: datetime
    updated_at: datetime


class ImportBatchListResponse(BaseModel):
    items: list[ImportBatchItem]
    total: int
    page: int
    page_size: int


class ImportBatchDetail(BaseModel):
    batch: ImportBatchItem
    error_report: list[Any]
    field_mapping: dict[str, Any]


class ImportErrorItem(BaseModel):
    row_number: int | None = None
    sample_id: str | None = None
    reason: str


class ImportUploadResult(BaseModel):
    import_batch_id: int
    total_rows: int
    success_rows: int
    failed_rows: int
    errors: list[ImportErrorItem]
    scan_triggered: bool = False
    scan_message: str | None = None
    return_message: str | None = None


class RemoveCreatedSamplesRequest(BaseModel):
    reason: str = Field(min_length=2, max_length=500)


class RemoveCreatedSamplesResult(BaseModel):
    batch_id: int
    removed_count: int
    updated_count: int


class ConfirmBatchStorageResult(BaseModel):
    batch_id: int
    stored_count: int


class ExcelSheetInspectResult(BaseModel):
    sheet_names: list[str]
    suggested_sheet_name: str | None = None
    has_sample_code_column: bool = False
    sample_code_columns: list[str] = []
    detected_specimen_type: str | None = None
    detected_specimen_type_label: str | None = None
    specimen_type_counts: dict[str, int] = Field(default_factory=dict)
    detected_center_code: str | None = None
    detected_center_name: str | None = None
    detected_specimen_type: str | None = None
    detected_specimen_type_label: str | None = None
    specimen_type_counts: dict[str, int] = {}


class DnaPlatePreviewRow(BaseModel):
    row_number: int
    sample_id: str
    sample_code: str
    barcode_no: str | None = None
    experiment_no: str | None = None
    source_batch: str | None = None
    aliquot_no: str | None = None
    plate_code: str
    well_code: str
    action: str
    message: str | None = None


class DnaPlatePreviewResult(BaseModel):
    total_rows: int
    valid_rows: int
    error_rows: int
    new_rows: int
    existing_rows: int
    plate_count: int
    can_import: bool
    rows: list[DnaPlatePreviewRow]
    errors: list[ImportErrorItem]


def clean_cell_text(value: Any) -> str | None:
    if value is None:
        return None
    text_value = str(value).strip().replace("\n", "").replace("\r", "").replace("\t", "")
    return text_value or None


def detect_center_from_rows(
    db: Session,
    headers: list[str],
    rows: list[tuple[Any, ...]],
) -> tuple[str | None, str | None]:
    sample_code_columns = find_sample_code_headers(headers)
    if not sample_code_columns:
        return None, None

    code_rules = get_confirmed_specimen_code_rules(db, active_only=False)
    code_indexes = [headers.index(column) for column in sample_code_columns if column in headers]
    detected_center_code: str | None = None
    for row in rows:
        for index in code_indexes:
            if index >= len(row):
                continue
            sample_code = clean_cell_text(row[index])
            if not sample_code:
                continue
            parsed = parse_sample_code(sample_code, code_rules)
            if parsed is None:
                continue
            detected_center_code = parsed[0]
            break
        if detected_center_code:
            break

    if not detected_center_code:
        return None, None

    center_name = db.execute(
        text(
            """
            SELECT center_name
            FROM centers
            WHERE center_code = :center_code
            """
        ),
        {"center_code": detected_center_code},
    ).scalar_one_or_none()
    return detected_center_code, center_name


def detect_specimen_type_from_rows(
    db: Session,
    headers: list[str],
    rows: list[tuple[Any, ...]],
) -> tuple[str | None, str | None, dict[str, int]]:
    sample_code_columns = find_sample_code_headers(headers)
    if not sample_code_columns:
        return None, None, {}

    code_rules = get_confirmed_specimen_code_rules(db, active_only=False)
    code_indexes = [headers.index(column) for column in sample_code_columns if column in headers]
    counts: dict[str, int] = {}
    for row in rows:
        for index in code_indexes:
            if index >= len(row):
                continue
            sample_code = clean_cell_text(row[index])
            if not sample_code:
                continue
            parsed = parse_sample_code(sample_code, code_rules)
            if parsed is None:
                continue
            parts = parse_sample_code_parts(sample_code, code_rules)
            if parts is None:
                continue
            counts[parts.specimen_type] = counts.get(parts.specimen_type, 0) + 1
            break

    if not counts:
        return None, None, {}
    if len(counts) > 1:
        return "mixed", "混合", counts
    specimen_type = next(iter(counts))
    return specimen_type, specimen_type, counts


def ensure_admin(current_user: CurrentUser) -> None:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有管理员可以导入 Excel",
        )


def safe_file_name(file_name: str) -> str:
    name = Path(file_name).name
    return re.sub(r"[^0-9A-Za-z\u4e00-\u9fff._-]+", "_", name).strip("._") or "sample.xlsx"


def get_import_batch_row(db: Session, batch_id: int) -> dict[str, Any] | None:
    row = (
        db.execute(
            text(
                """
                SELECT b.id,
                       b.file_name,
                       b.file_path,
                       b.uploaded_by,
                       COALESCE(u.display_name, u.username) AS uploaded_by_name,
                       b.uploaded_at,
                       b.total_rows,
                       b.success_rows,
                       b.failed_rows,
                       COALESCE(b.import_type, 'sample') AS import_type,
                       b.status,
                       COALESCE(item_stats.created_count, 0) AS created_count,
                       COALESCE(item_stats.updated_count, 0) AS updated_count,
                       COALESCE(item_stats.removed_count, 0) AS removed_count,
                       COALESCE(item_stats.pending_storage_count, 0) AS pending_storage_count,
                       b.error_report,
                       b.field_mapping,
                       b.created_at,
                       b.updated_at
                FROM sample_import_batches b
                LEFT JOIN users u ON u.id = b.uploaded_by
                LEFT JOIN LATERAL (
                    SELECT count(*) FILTER (WHERE i.action_type = 'created') AS created_count,
                           count(*) FILTER (WHERE i.action_type = 'updated') AS updated_count,
                           count(*) FILTER (
                               WHERE i.action_type = 'created' AND i.removed_at IS NOT NULL
                           ) AS removed_count,
                           count(*) FILTER (
                               WHERE i.removed_at IS NULL
                                 AND s.sample_status = 'not_stored'
                                 AND s.is_deleted = false
                           ) AS pending_storage_count
                    FROM sample_import_items i
                    JOIN samples s ON s.id = i.sample_pk
                    WHERE i.import_batch_id = b.id
                ) item_stats ON true
                WHERE b.id = :batch_id
                """
            ),
            {"batch_id": batch_id},
        )
        .mappings()
        .first()
    )
    return dict(row) if row is not None else None


def build_filters(keyword: str | None, import_status: str | None) -> tuple[str, dict[str, Any]]:
    clauses = ["1 = 1"]
    params: dict[str, Any] = {}

    if keyword:
        clauses.append(
            """
            (
                b.file_name ILIKE :keyword
                OR COALESCE(u.username, '') ILIKE :keyword
                OR COALESCE(u.display_name, '') ILIKE :keyword
            )
            """
        )
        params["keyword"] = f"%{keyword.strip()}%"

    if import_status:
        if import_status not in {"previewed", "imported", "partial", "failed", "cancelled"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无效的导入状态")
        clauses.append("b.status = :status")
        params["status"] = import_status

    return " AND ".join(clauses), params


@router.post("/inspect-sheets", response_model=ExcelSheetInspectResult)
async def inspect_excel_sheets(
    file: UploadFile = File(...),
    sheet_name: str | None = Form(default=None),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ExcelSheetInspectResult:
    ensure_admin(current_user)
    original_name = file.filename or "sample.xlsx"
    suffix = Path(original_name).suffix.lower()
    if suffix == ".csv":
        content = await read_limited_upload(file)
        text_value = content.decode("utf-8-sig", errors="ignore")
        csv_rows = list(csv.reader(StringIO(text_value)))
        headers = [str(value).strip() for value in csv_rows[0]] if csv_rows else []
        data_rows = [tuple(row) for row in csv_rows[1:]]
        sample_code_columns = find_sample_code_headers([str(value).strip() for value in headers])
        detected_center_code, detected_center_name = detect_center_from_rows(db, headers, data_rows)
        detected_specimen_type, detected_specimen_type_label, specimen_type_counts = detect_specimen_type_from_rows(
            db, headers, data_rows
        )
        return ExcelSheetInspectResult(
            sheet_names=[CSV_SHEET_NAME],
            suggested_sheet_name=CSV_SHEET_NAME,
            has_sample_code_column=bool(sample_code_columns),
            sample_code_columns=sample_code_columns,
            detected_center_code=detected_center_code,
            detected_center_name=detected_center_name,
            detected_specimen_type=detected_specimen_type,
            detected_specimen_type_label=detected_specimen_type_label,
            specimen_type_counts=specimen_type_counts,
        )
    if suffix not in EXCEL_SUFFIXES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请上传 .xls、.xlsx、.xlsm 或 .csv 格式的文件",
        )

    content = await read_limited_upload(file)

    try:
        with temporary_import_file(content, suffix):
            pass
        wb = load_excel_workbook(content, suffix, read_only=True, data_only=True)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception:
        logger.exception("读取上传的工作簿失败")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="无法读取文件，请确认文件格式正确且文件未损坏",
        ) from None

    try:
        sheet_names = list(wb.sheetnames)
    finally:
        wb.close()

    requested_sheet = sheet_name.strip() if sheet_name and sheet_name.strip() else None
    if requested_sheet and requested_sheet not in sheet_names:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"工作表不存在：{requested_sheet}",
        )
    suggested = requested_sheet or (
        "汇总数据" if "汇总数据" in sheet_names else (sheet_names[0] if sheet_names else None)
    )
    sample_code_columns: list[str] = []
    if suggested:
        try:
            wb2 = load_excel_workbook(content, suffix, read_only=True, data_only=True)
            try:
                ws = wb2[suggested]
                headers = [str(cell.value).strip() if cell.value is not None else "" for cell in ws[1]]
                sample_code_columns = find_sample_code_headers(headers)
                data_rows = [
                    tuple(row)
                    for row in ws.iter_rows(min_row=2, values_only=True)
                    if any(value is not None and str(value).strip() for value in row)
                ]
                detected_center_code, detected_center_name = detect_center_from_rows(db, headers, data_rows)
                (
                    detected_specimen_type,
                    detected_specimen_type_label,
                    specimen_type_counts,
                ) = detect_specimen_type_from_rows(db, headers, data_rows)
            finally:
                wb2.close()
        except Exception:
            sample_code_columns = []
            detected_center_code = None
            detected_center_name = None
            detected_specimen_type = None
            detected_specimen_type_label = None
            specimen_type_counts = {}
    else:
        detected_center_code = None
        detected_center_name = None
    return ExcelSheetInspectResult(
        sheet_names=sheet_names,
        suggested_sheet_name=suggested,
        has_sample_code_column=bool(sample_code_columns),
        sample_code_columns=sample_code_columns,
        detected_center_code=detected_center_code,
        detected_center_name=detected_center_name,
        detected_specimen_type=detected_specimen_type,
        detected_specimen_type_label=detected_specimen_type_label,
        specimen_type_counts=specimen_type_counts,
    )


@router.post("/upload", response_model=ImportUploadResult)
async def upload_excel(
    file: UploadFile = File(...),
    sheet_name: str = Form(default="汇总数据"),
    allow_nonstandard_id: bool = Form(default=False),
    default_status: str = Form(default="not_stored"),
    duplicate_strategy: str = Form(default="error"),
    import_mode: str = Form(default="atomic"),
    freezer_no: str | None = Form(default=None),
    shelf_no: str | None = Form(default=None),
    box_no: str | None = Form(default=None),
    storage_position: str | None = Form(default=None),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ImportUploadResult:
    ensure_admin(current_user)
    original_name = file.filename or "sample.xlsx"
    suffix = Path(original_name).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请上传 .xls、.xlsx、.xlsm 或 .csv 格式的文件",
        )

    if import_mode not in {"atomic", "best_effort"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无效的导入事务模式")
    content = await read_limited_upload(file)

    try:
        with temporary_import_file(content, suffix) as target_path:
            result = import_excel_file(
                db=db,
                path=target_path,
                sheet_name=CSV_SHEET_NAME if suffix == ".csv" else sheet_name.strip() or "汇总数据",
                uploaded_by=current_user.id,
                allow_nonstandard=allow_nonstandard_id,
                original_file_name=original_name,
                default_status=default_status,
                require_sample_code=True,
                freezer_no=freezer_no,
                shelf_no=shelf_no,
                box_no=box_no,
                storage_position=storage_position,
                duplicate_strategy=duplicate_strategy,
                atomic=import_mode == "atomic",
            )
    except DuplicateSampleCodeError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "duplicate_sample_code",
                "message": str(exc),
                "duplicate_codes": exc.duplicate_codes,
            },
        )
    except AtomicImportError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "atomic_import_rolled_back", "message": str(exc), "errors": exc.errors},
        ) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception:
        db.rollback()
        logger.exception("样本基础信息导入失败")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="导入失败，请稍后重试或联系系统管理员",
        ) from None

    return ImportUploadResult(
        import_batch_id=result.import_batch_id,
        total_rows=result.total_rows,
        success_rows=result.success_rows,
        failed_rows=result.failed_rows,
        errors=result.errors,
        scan_triggered=False,
        scan_message=None,
    )


@router.post("/dna-plates/preview", response_model=DnaPlatePreviewResult)
async def preview_dna_plate_excel(
    file: UploadFile = File(...),
    sheet_name: str = Form(default="汇总数据"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> DnaPlatePreviewResult:
    ensure_admin(current_user)
    original_name = file.filename or "dna_plate.xlsx"
    suffix = Path(original_name).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请上传 .xls、.xlsx、.xlsm 或 .csv 格式的文件",
        )

    content = await read_limited_upload(file)

    try:
        with temporary_import_file(content, suffix) as preview_path:
            result = preview_dna_plate_file(
                db,
                preview_path,
                CSV_SHEET_NAME if suffix == ".csv" else sheet_name.strip() or "汇总数据",
            )
        return DnaPlatePreviewResult(**result.__dict__)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.post("/dna-plates/import", response_model=ImportUploadResult)
async def import_dna_plate_excel(
    file: UploadFile = File(...),
    sheet_name: str = Form(default="汇总数据"),
    default_status: str = Form(default="in_storage"),
    freezer_code: str | None = Form(default=None),
    layer_no: str | None = Form(default=None),
    container_no: str | None = Form(default=None),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ImportUploadResult:
    ensure_admin(current_user)
    original_name = file.filename or "dna_plate.xlsx"
    suffix = Path(original_name).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请上传 .xls、.xlsx、.xlsm 或 .csv 格式的文件",
        )

    content = await read_limited_upload(file)

    try:
        with temporary_import_file(content, suffix) as target_path:
            result = import_dna_plate_file(
                db=db,
                path=target_path,
                sheet_name=CSV_SHEET_NAME if suffix == ".csv" else sheet_name.strip() or "汇总数据",
                uploaded_by=current_user.id,
                original_file_name=original_name,
                default_status=default_status,
                freezer_code=freezer_code,
                layer_no=layer_no,
                container_no=container_no,
            )
        return ImportUploadResult(**result.__dict__)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception:
        db.rollback()
        logger.exception("DNA 板位导入失败")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="DNA 板位导入失败，请稍后重试或联系系统管理员",
        ) from None


@router.post("/genome/upload", response_model=ImportUploadResult)
async def upload_genome_info_excel(
    file: UploadFile = File(...),
    sheet_name: str = Form(default="汇总数据"),
    sequencing_company: str | None = Form(default=None),
    sequencing_platform: str | None = Form(default=None),
    sequencing_instrument: str | None = Form(default=None),
    sequencing_returned_at: str | None = Form(default=None),
    sync_return: bool = Form(default=False),
    duplicate_strategy: str = Form(default="error"),
    import_mode: str = Form(default="atomic"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ImportUploadResult:
    ensure_admin(current_user)
    original_name = file.filename or "genome_info.xlsx"
    suffix = Path(original_name).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请上传 .xls、.xlsx、.xlsm 或 .csv 格式的文件",
        )

    returned_at_value: datetime | None = None
    if sequencing_returned_at:
        try:
            returned_at_value = datetime.fromisoformat(sequencing_returned_at.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="回库时间格式不正确")

    if import_mode not in {"atomic", "best_effort"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无效的导入事务模式")
    content = await read_limited_upload(file)

    try:
        with temporary_import_file(content, suffix) as target_path:
            result = import_genome_info_file(
                db=db,
                path=target_path,
                sheet_name=CSV_SHEET_NAME if suffix == ".csv" else sheet_name.strip() or "汇总数据",
                uploaded_by=current_user.id,
                original_file_name=original_name,
                default_company=sequencing_company,
                default_platform=sequencing_platform,
                default_instrument=sequencing_instrument,
                default_returned_at=returned_at_value,
                sync_return=sync_return,
                duplicate_strategy=duplicate_strategy,
                atomic=import_mode == "atomic",
            )
    except DuplicateGenomeStatusError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "duplicate_genome_status",
                "message": str(exc),
                "duplicate_codes": exc.duplicate_codes,
            },
        )
    except AtomicImportError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "atomic_import_rolled_back", "message": str(exc), "errors": exc.errors},
        ) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception:
        db.rollback()
        logger.exception("基因组信息导入失败")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="基因组信息导入失败，请稍后重试或联系系统管理员",
        ) from None

    return ImportUploadResult(
        import_batch_id=result.import_batch_id,
        total_rows=result.total_rows,
        success_rows=result.success_rows,
        failed_rows=result.failed_rows,
        errors=result.errors,
        return_message="，".join(
            part
            for part in [
                f"同步回库 {result.return_updated_rows} 条" if sync_return else "",
                f"跳过 {result.return_skipped_rows} 条非测序中样本" if sync_return and result.return_skipped_rows else "",
            ]
            if part
        )
        or None,
    )


@router.get("/batches", response_model=ImportBatchListResponse)
def list_import_batches(
    keyword: str | None = Query(default=None),
    import_status: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ImportBatchListResponse:
    ensure_admin(current_user)
    where_sql, params = build_filters(keyword, import_status)
    offset = (page - 1) * page_size

    total = db.execute(
        text(
            f"""
            SELECT count(*)
            FROM sample_import_batches b
            LEFT JOIN users u ON u.id = b.uploaded_by
            WHERE {where_sql}
            """
        ),
        params,
    ).scalar_one()

    rows = (
        db.execute(
            text(
                f"""
                SELECT b.id,
                       b.file_name,
                       b.file_path,
                       b.uploaded_by,
                       COALESCE(u.display_name, u.username) AS uploaded_by_name,
                       b.uploaded_at,
                       b.total_rows,
                       b.success_rows,
                       b.failed_rows,
                       COALESCE(b.import_type, 'sample') AS import_type,
                       b.status,
                       COALESCE(item_stats.created_count, 0) AS created_count,
                       COALESCE(item_stats.updated_count, 0) AS updated_count,
                       COALESCE(item_stats.removed_count, 0) AS removed_count,
                       COALESCE(item_stats.pending_storage_count, 0) AS pending_storage_count,
                       b.created_at,
                       b.updated_at
                FROM sample_import_batches b
                LEFT JOIN users u ON u.id = b.uploaded_by
                LEFT JOIN LATERAL (
                    SELECT count(*) FILTER (WHERE i.action_type = 'created') AS created_count,
                           count(*) FILTER (WHERE i.action_type = 'updated') AS updated_count,
                           count(*) FILTER (
                               WHERE i.action_type = 'created' AND i.removed_at IS NOT NULL
                           ) AS removed_count,
                           count(*) FILTER (
                               WHERE i.removed_at IS NULL
                                 AND s.sample_status = 'not_stored'
                                 AND s.is_deleted = false
                           ) AS pending_storage_count
                    FROM sample_import_items i
                    JOIN samples s ON s.id = i.sample_pk
                    WHERE i.import_batch_id = b.id
                ) item_stats ON true
                WHERE {where_sql}
                ORDER BY b.uploaded_at DESC, b.id DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {**params, "limit": page_size, "offset": offset},
        )
        .mappings()
        .all()
    )

    return ImportBatchListResponse(
        items=[ImportBatchItem(**row) for row in rows],
        total=int(total),
        page=page,
        page_size=page_size,
    )


@router.post(
    "/batches/{batch_id}/confirm-storage",
    response_model=ConfirmBatchStorageResult,
)
def confirm_import_batch_storage(
    batch_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ConfirmBatchStorageResult:
    """Confirm physical receipt for all still-un-stored samples recorded by one import batch."""
    ensure_admin(current_user)
    batch = db.execute(
        text(
            """
            SELECT id, import_type, status
            FROM sample_import_batches
            WHERE id = :batch_id
            FOR UPDATE
            """
        ),
        {"batch_id": batch_id},
    ).mappings().first()
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="导入批次不存在")
    if batch["import_type"] not in {"sample", "dna_plate"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前导入类型不支持批量确认入库")
    if batch["status"] not in {"imported", "partial"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前批次状态不允许确认入库")

    samples = db.execute(
        text(
            """
            SELECT s.id, s.sample_id, s.sample_code, s.storage_location
            FROM sample_import_items i
            JOIN samples s ON s.id = i.sample_pk
            WHERE i.import_batch_id = :batch_id
              AND i.removed_at IS NULL
              AND s.is_deleted = false
              AND s.sample_status = 'not_stored'
            ORDER BY s.id
            FOR UPDATE OF s
            """
        ),
        {"batch_id": batch_id},
    ).mappings().all()
    if not samples:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该批次当前没有待确认入库的样本")

    sample_ids = [int(sample["id"]) for sample in samples]
    db.execute(
        text(
            """
            UPDATE samples
            SET sample_status = 'in_storage',
                current_holder_id = NULL,
                updated_by = :operator_id,
                updated_at = now()
            WHERE id = ANY(:sample_ids)
              AND sample_status = 'not_stored'
              AND is_deleted = false
            """
        ),
        {"sample_ids": sample_ids, "operator_id": current_user.id},
    )
    movement_rows = [
        {
            "sample_pk": sample["id"],
            "sample_id": sample["sample_id"],
            "sample_code": sample["sample_code"],
            "after_location": sample["storage_location"],
            "operator_id": current_user.id,
            "operator_role": current_user.role,
            "batch_id": batch_id,
            "detail": json.dumps(
                {"source": "import_batch_storage_confirm", "import_batch_id": batch_id},
                ensure_ascii=False,
            ),
            "ip_address": client_ip_from_request(request),
            "device_info": request.headers.get("user-agent"),
        }
        for sample in samples
    ]
    db.execute(
        text(
            """
            INSERT INTO sample_movement_logs (
                sample_pk, sample_id, sample_code, action_type,
                before_status, after_status, after_location,
                operator_id, operator_role, related_record_id,
                detail, note, ip_address, device_info
            )
            VALUES (
                :sample_pk, :sample_id, :sample_code, 'import_batch_storage_confirm',
                'not_stored', 'in_storage', :after_location,
                :operator_id, :operator_role, :batch_id,
                CAST(:detail AS jsonb), '导入批次批量确认入库', :ip_address, :device_info
            )
            """
        ),
        movement_rows,
    )
    db.commit()
    return ConfirmBatchStorageResult(batch_id=batch_id, stored_count=len(samples))


@router.post(
    "/batches/{batch_id}/remove-created-samples",
    response_model=RemoveCreatedSamplesResult,
)
def remove_created_samples_from_batch(
    batch_id: int,
    payload: RemoveCreatedSamplesRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> RemoveCreatedSamplesResult:
    ensure_admin(current_user)
    batch = db.execute(
        text(
            """
            SELECT id, import_type, status
            FROM sample_import_batches
            WHERE id = :batch_id
            FOR UPDATE
            """
        ),
        {"batch_id": batch_id},
    ).mappings().first()
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="导入批次不存在")
    if batch["import_type"] not in {"sample", "dna_plate"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="仅样本基础信息或 DNA 板位导入批次支持清理新增样本",
        )
    if batch["status"] not in {"imported", "partial"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前批次状态不允许清理新增样本")

    item_counts = db.execute(
        text(
            """
            SELECT count(*) FILTER (WHERE action_type = 'created') AS created_count,
                   count(*) FILTER (WHERE action_type = 'updated') AS updated_count,
                   count(*) FILTER (
                       WHERE action_type = 'created' AND removed_at IS NOT NULL
                   ) AS removed_count
            FROM sample_import_items
            WHERE import_batch_id = :batch_id
            """
        ),
        {"batch_id": batch_id},
    ).mappings().one()
    created_count = int(item_counts["created_count"] or 0)
    updated_count = int(item_counts["updated_count"] or 0)
    removed_count = int(item_counts["removed_count"] or 0)
    if created_count == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该批次没有可追溯的新建样本；旧批次或纯覆盖批次不能执行此操作",
        )
    if removed_count >= created_count:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该批次新增样本已经清理过")

    conflicts = db.execute(
        text(
            """
            SELECT i.sample_code
            FROM sample_import_items i
            JOIN samples s ON s.id = i.sample_pk
            WHERE i.import_batch_id = :batch_id
              AND i.action_type = 'created'
              AND i.removed_at IS NULL
              AND s.is_deleted = false
              AND (
                    EXISTS (
                        SELECT 1 FROM sample_import_items later
                        WHERE later.sample_pk = i.sample_pk
                          AND later.import_batch_id <> :batch_id
                    )
                    OR EXISTS (
                        SELECT 1 FROM sample_raw_records raw
                        WHERE raw.sample_pk = i.sample_pk
                          AND raw.import_batch_id IS DISTINCT FROM :batch_id
                    )
                    OR EXISTS (SELECT 1 FROM sample_movement_logs m WHERE m.sample_pk = i.sample_pk)
                    OR EXISTS (SELECT 1 FROM sample_checkout_records c WHERE c.sample_pk = i.sample_pk)
                    OR EXISTS (SELECT 1 FROM sample_usage_records u WHERE u.sample_pk = i.sample_pk)
                    OR EXISTS (SELECT 1 FROM sample_return_records r WHERE r.sample_pk = i.sample_pk)
                    OR EXISTS (SELECT 1 FROM sample_genome_status g WHERE g.sample_pk = i.sample_pk)
                    OR EXISTS (SELECT 1 FROM secure_documents d WHERE d.sample_pk = i.sample_pk)
                    OR EXISTS (
                        SELECT 1 FROM sample_plate_wells w
                        WHERE w.sample_pk = i.sample_pk
                          AND w.import_batch_id IS DISTINCT FROM :batch_id
                    )
              )
            ORDER BY i.sample_code
            """
        ),
        {"batch_id": batch_id},
    ).scalars().all()
    if conflicts:
        preview = "、".join(str(code) for code in conflicts[:10])
        suffix = f" 等 {len(conflicts)} 条" if len(conflicts) > 10 else ""
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"有样本在导入后产生了后续业务数据，不能自动清理：{preview}{suffix}",
        )

    affected_plate_ids: list[int] = []
    if batch["import_type"] == "dna_plate":
        affected_plate_ids = list(
            db.execute(
                text(
                    """
                    WITH removed_wells AS (
                        DELETE FROM sample_plate_wells w
                        USING sample_import_items i
                        WHERE i.import_batch_id = :batch_id
                          AND i.action_type = 'created'
                          AND i.removed_at IS NULL
                          AND i.sample_pk = w.sample_pk
                          AND w.import_batch_id = :batch_id
                        RETURNING w.plate_id
                    )
                    SELECT DISTINCT plate_id
                    FROM removed_wells
                    """
                ),
                {"batch_id": batch_id},
            ).scalars().all()
        )

    removed_ids = db.execute(
        text(
            """
            UPDATE samples s
            SET is_deleted = true,
                updated_by = :removed_by,
                updated_at = now()
            FROM sample_import_items i
            WHERE i.import_batch_id = :batch_id
              AND i.action_type = 'created'
              AND i.removed_at IS NULL
              AND i.sample_pk = s.id
              AND s.is_deleted = false
            RETURNING s.id
            """
        ),
        {"batch_id": batch_id, "removed_by": current_user.id},
    ).scalars().all()
    if removed_ids:
        db.execute(
            text(
                """
                DELETE FROM sample_relations
                WHERE parent_sample_pk = ANY(CAST(:sample_pks AS bigint[]))
                   OR child_sample_pk = ANY(CAST(:sample_pks AS bigint[]))
                """
            ),
            {"sample_pks": removed_ids},
        )
        for table_name in (
            "participant_private_info",
            "sample_raw_records",
            "sample_storage",
        ):
            db.execute(
                text(
                    f"DELETE FROM {table_name} "
                    "WHERE sample_pk = ANY(CAST(:sample_pks AS bigint[]))"
                ),
                {"sample_pks": removed_ids},
            )
    db.execute(
        text(
            """
            UPDATE sample_import_items
            SET removed_at = now(),
                removed_by = :removed_by,
                remove_reason = :reason
            WHERE import_batch_id = :batch_id
              AND action_type = 'created'
              AND removed_at IS NULL
            """
        ),
        {
            "batch_id": batch_id,
            "removed_by": current_user.id,
            "reason": payload.reason.strip(),
        },
    )
    if affected_plate_ids:
        db.execute(
            text(
                """
                DELETE FROM sample_plates p
                WHERE p.id = ANY(:plate_ids)
                  AND NOT EXISTS (
                      SELECT 1
                      FROM sample_plate_wells w
                      WHERE w.plate_id = p.id
                  )
                """
            ),
            {"plate_ids": affected_plate_ids},
        )
    db.commit()
    return RemoveCreatedSamplesResult(
        batch_id=batch_id,
        removed_count=len(removed_ids),
        updated_count=updated_count,
    )


@router.get("/batches/{batch_id}", response_model=ImportBatchDetail)
def get_import_batch(
    batch_id: int,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ImportBatchDetail:
    ensure_admin(current_user)
    row_dict = get_import_batch_row(db, batch_id)

    if row_dict is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="导入批次不存在")

    error_report = row_dict.pop("error_report") or []
    field_mapping = row_dict.pop("field_mapping") or {}
    return ImportBatchDetail(
        batch=ImportBatchItem(**row_dict),
        error_report=error_report,
        field_mapping=field_mapping,
    )


@router.get("/batches/{batch_id}/errors.csv")
def export_import_batch_errors(
    batch_id: int,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    ensure_admin(current_user)
    row = get_import_batch_row(db, batch_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="导入批次不存在")

    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["行号", "样本编号", "失败原因"])
    for error in row.get("error_report") or []:
        if isinstance(error, dict):
            writer.writerow([error.get("row_number") or "", error.get("sample_id") or "", error.get("reason") or ""])
        else:
            writer.writerow(["", "", str(error)])

    content = "\ufeff" + output.getvalue()
    file_name = safe_file_name(f"import_batch_{batch_id}_errors.csv")
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{file_name}"'},
    )
