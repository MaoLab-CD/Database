from __future__ import annotations

import csv
import hmac
import json
import logging
import re
from contextlib import contextmanager
from datetime import datetime
from io import StringIO
from pathlib import Path
from typing import Any, Iterator, Literal
from uuid import uuid4

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
    import_excel_file,
)
from app.services.hospital_uploads import (
    ALLOWED_HOSPITAL_SUFFIXES,
    MAX_UPLOAD_BYTES,
    TEMPLATE_VERSION,
    build_hospital_code_assignments,
    build_hospital_review_preview,
    build_hospital_review_preview_workbook,
    build_hospital_submission_preview,
    build_hospital_upload_template,
    resolve_workbook_sheet_name,
    validate_hospital_upload,
)
from app.services.hospital_file_storage import (
    ENCRYPTED_FILE_SUFFIX,
    HospitalFileDecryptionError,
    plaintext_suffix_for_stored_path,
    read_hospital_file,
    sha256_bytes,
    temporary_plaintext_file,
    write_encrypted_hospital_file,
)
from app.services.workbook_loader import normalize_excel_content

router = APIRouter()
logger = logging.getLogger(__name__)

HOSPITAL_UPLOAD_DIR = Path(__file__).resolve().parents[3] / "uploads" / "hospital" / "quarantine"
ALLOWED_REVIEW_STATUSES = {"not_stored", "in_storage", "sequencing"}


class HospitalUploadError(BaseModel):
    row_number: int | None = None
    sample_id: str | None = None
    sample_code: str | None = None
    reason: str
    error_type: str


class HospitalUploadItem(BaseModel):
    id: int
    file_name: str
    file_hash: str
    file_size: int
    template_version: str
    sheet_name: str
    center_code: str
    center_name: str | None = None
    uploaded_by: int
    uploaded_by_name: str | None = None
    status: str
    total_rows: int
    valid_rows: int
    error_rows: int
    new_rows: int
    duplicate_rows: int
    validation_summary: dict[str, Any] = Field(default_factory=dict)
    submitted_at: datetime | None = None
    reviewed_by: int | None = None
    reviewed_by_name: str | None = None
    reviewed_at: datetime | None = None
    review_comment: str | None = None
    default_status: str | None = None
    import_batch_id: int | None = None
    imported_by: int | None = None
    imported_by_name: str | None = None
    imported_at: datetime | None = None
    import_error: str | None = None
    cancelled_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class HospitalUploadDetail(BaseModel):
    batch: HospitalUploadItem
    errors: list[HospitalUploadError]
    events: list[dict[str, Any]]


class HospitalUploadListResponse(BaseModel):
    items: list[HospitalUploadItem]
    total: int
    page: int
    page_size: int


class HospitalReviewRequest(BaseModel):
    action: Literal["approve", "reject"]
    comment: str | None = Field(default=None, max_length=1000)


class HospitalImportRequest(BaseModel):
    default_status: str


class HospitalCodePreviewRow(BaseModel):
    row_number: int
    sample_id: str
    collection_date: str
    specimen_type: str
    sample_code: str


class HospitalCodePreviewResponse(BaseModel):
    total_rows: int
    date_counts: dict[str, int]
    rows: list[HospitalCodePreviewRow]


class HospitalReviewPreviewRow(BaseModel):
    row_number: int
    values: list[Any]


class HospitalReviewPreviewResponse(BaseModel):
    total_rows: int
    displayed_rows: int
    headers: list[str]
    sensitive_columns: list[int]
    date_counts: dict[str, int]
    specimen_type_counts: dict[str, int]
    rows: list[HospitalReviewPreviewRow]


class HospitalSubmissionPreviewResponse(BaseModel):
    total_rows: int
    displayed_rows: int
    headers: list[str]
    sensitive_columns: list[int]
    rows: list[HospitalReviewPreviewRow]


def safe_file_name(file_name: str) -> str:
    name = Path(file_name).name
    return re.sub(r"[^0-9A-Za-z\u4e00-\u9fff._-]+", "_", name).strip("._") or "hospital_upload.xlsx"


def client_ip(request: Request) -> str | None:
    return client_ip_from_request(request)


def ensure_hospital_submit(current_user: CurrentUser) -> str:
    if current_user.role != "user" or current_user.account_type != "hospital":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="当前账号不是医院数据提交账号")
    if not current_user.permissions.get("hospital_data_submit"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="当前账号没有医院数据上传权限")
    if len(current_user.center_codes) != 1:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="医院账号必须绑定且只能绑定一个中心")
    return current_user.center_codes[0]


def ensure_reviewer(current_user: CurrentUser) -> None:
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有内部管理员可以审核医院数据")


def record_event(
    db: Session,
    batch_id: int,
    actor_id: int | None,
    event_type: str,
    detail: dict[str, Any],
    request: Request,
) -> None:
    db.execute(
        text(
            """
            INSERT INTO hospital_upload_events (batch_id, actor_id, event_type, detail, client_ip)
            VALUES (:batch_id, :actor_id, :event_type, CAST(:detail AS jsonb), :client_ip)
            """
        ),
        {
            "batch_id": batch_id,
            "actor_id": actor_id,
            "event_type": event_type,
            "detail": json.dumps(detail, ensure_ascii=False),
            "client_ip": client_ip(request),
        },
    )


BATCH_SELECT = """
    SELECT b.id,
           b.file_name,
           b.file_hash,
           b.file_size,
           b.template_version,
           b.sheet_name,
           b.center_code,
           c.center_name,
           b.uploaded_by,
           COALESCE(u.display_name, u.username) AS uploaded_by_name,
           b.status,
           b.total_rows,
           b.valid_rows,
           b.error_rows,
           b.new_rows,
           b.duplicate_rows,
           b.validation_summary,
           b.submitted_at,
           b.reviewed_by,
           COALESCE(r.display_name, r.username) AS reviewed_by_name,
           b.reviewed_at,
           b.review_comment,
           b.default_status,
           b.import_batch_id,
           b.imported_by,
           COALESCE(i.display_name, i.username) AS imported_by_name,
           b.imported_at,
           b.import_error,
           b.cancelled_at,
           b.created_at,
           b.updated_at
    FROM hospital_upload_batches b
    JOIN centers c ON c.center_code = b.center_code
    JOIN users u ON u.id = b.uploaded_by
    LEFT JOIN users r ON r.id = b.reviewed_by
    LEFT JOIN users i ON i.id = b.imported_by
"""


def get_batch_row(db: Session, batch_id: int, *, for_update: bool = False) -> dict[str, Any] | None:
    suffix = " FOR UPDATE OF b" if for_update else ""
    row = db.execute(
        text(BATCH_SELECT + " WHERE b.id = :batch_id" + suffix),
        {"batch_id": batch_id},
    ).mappings().first()
    return dict(row) if row is not None else None


def get_batch_storage_row(db: Session, batch_id: int, *, for_update: bool = False) -> dict[str, Any] | None:
    suffix = " FOR UPDATE" if for_update else ""
    row = db.execute(
        text(
            """
            SELECT id, file_path, file_name, file_hash, file_size, sheet_name, center_code,
                   uploaded_by, status, error_report, default_status
            FROM hospital_upload_batches
            WHERE id = :batch_id
            """ + suffix
        ),
        {"batch_id": batch_id},
    ).mappings().first()
    return dict(row) if row is not None else None


def ensure_owner(batch: dict[str, Any], current_user: CurrentUser) -> None:
    if batch["uploaded_by"] != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="上传批次不存在")


def resolve_stored_path(file_path: str) -> Path:
    upload_root = HOSPITAL_UPLOAD_DIR.resolve()
    storage_name = Path(file_path).name
    if not storage_name or storage_name in {".", ".."}:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="上传文件存储路径异常")
    # New batches store only the random storage filename. For legacy batches
    # that saved an absolute container/deployment path, resolve the basename
    # inside the current quarantine directory so redeployment does not break
    # resubmission. The hash check below still verifies the exact file content.
    path = (upload_root / storage_name).resolve()
    if path.parent != upload_root:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="上传文件存储路径异常")
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="原始上传文件不存在，请重新上传")
    return path


def read_verified_stored_file(path: Path, expected_hash: str) -> bytes:
    try:
        content, _ = read_hospital_file(path)
    except HospitalFileDecryptionError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="隔离区加密文件无法解密，请联系管理员检查密钥或文件完整性",
        ) from None
    if not hmac.compare_digest(sha256_bytes(content), expected_hash):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="隔离区文件完整性校验失败，请撤销该批次并重新上传",
        )
    return content


def verify_stored_file(path: Path, expected_hash: str) -> None:
    read_verified_stored_file(path, expected_hash)


@contextmanager
def materialize_stored_file(path: Path, expected_hash: str) -> Iterator[Path]:
    content = read_verified_stored_file(path, expected_hash)
    with temporary_plaintext_file(content, plaintext_suffix_for_stored_path(path)) as plaintext_path:
        yield plaintext_path


@router.get("/template")
def download_template(current_user: CurrentUser = Depends(get_current_user)) -> Response:
    if current_user.role != "admin":
        ensure_hospital_submit(current_user)
    content = build_hospital_upload_template()
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="hospital_sample_upload_template_V1.xlsx"'},
    )


@router.post("/upload", response_model=HospitalUploadDetail)
async def upload_hospital_file(
    request: Request,
    file: UploadFile = File(...),
    sheet_name: str = Form(default="样本数据"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> HospitalUploadDetail:
    center_code = ensure_hospital_submit(current_user)
    original_name = file.filename or "hospital_upload.xlsx"
    suffix = Path(original_name).suffix.lower()
    if suffix not in ALLOWED_HOSPITAL_SUFFIXES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="仅支持 .xls、.xlsx、.xlsm 或 .csv 文件",
        )
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="文件不能超过 20 MB")
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="上传文件为空")

    stored_content = content
    stored_suffix = suffix
    if suffix != ".csv":
        try:
            stored_content, stored_suffix = normalize_excel_content(content, suffix)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        if len(stored_content) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="旧版 Excel 安全转换后不能超过 20 MB",
            )

    upload_hash = sha256_bytes(stored_content)

    duplicate_batch_id = db.execute(
        text(
            """
            SELECT id
            FROM hospital_upload_batches
            WHERE uploaded_by = :uploaded_by
              AND file_hash = :file_hash
              AND status <> 'cancelled'
            ORDER BY id DESC
            LIMIT 1
            """
        ),
        {"uploaded_by": current_user.id, "file_hash": upload_hash},
    ).scalar_one_or_none()
    if duplicate_batch_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"该文件已上传过（批次 #{duplicate_batch_id}），请勿重复提交",
        )

    try:
        with temporary_plaintext_file(stored_content, stored_suffix) as plaintext_path:
            resolved_sheet_name = resolve_workbook_sheet_name(plaintext_path, sheet_name)
            validation = validate_hospital_upload(
                db=db,
                path=plaintext_path,
                sheet_name=resolved_sheet_name,
                center_code=center_code,
            )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception:
        logger.exception("医院上传文件校验失败")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="文件校验失败，请稍后重试") from None

    HOSPITAL_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    storage_name = f"{datetime.now():%Y%m%d%H%M%S}_{uuid4().hex}{stored_suffix}{ENCRYPTED_FILE_SUFFIX}"
    target_path = HOSPITAL_UPLOAD_DIR / storage_name
    try:
        write_encrypted_hospital_file(target_path, stored_content)
        verify_stored_file(target_path, upload_hash)
    except Exception:
        target_path.unlink(missing_ok=True)
        logger.exception("医院上传文件加密存储失败")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="上传文件安全存储失败，请稍后重试") from None

    batch_status = "validated" if validation.is_valid else "validation_failed"
    batch_id = db.execute(
        text(
            """
            INSERT INTO hospital_upload_batches (
                file_name, file_path, file_hash, file_size, template_version, sheet_name,
                center_code, uploaded_by, status, total_rows, valid_rows, error_rows,
                new_rows, duplicate_rows, validation_summary, error_report
            ) VALUES (
                :file_name, :file_path, :file_hash, :file_size, :template_version, :sheet_name,
                :center_code, :uploaded_by, :status, :total_rows, :valid_rows, :error_rows,
                :new_rows, :duplicate_rows, CAST(:validation_summary AS jsonb), CAST(:error_report AS jsonb)
            ) RETURNING id
            """
        ),
        {
            "file_name": safe_file_name(original_name),
            "file_path": storage_name,
            "file_hash": upload_hash,
            "file_size": len(stored_content),
            "template_version": TEMPLATE_VERSION,
            "sheet_name": resolved_sheet_name,
            "center_code": center_code,
            "uploaded_by": current_user.id,
            "status": batch_status,
            "total_rows": validation.total_rows,
            "valid_rows": validation.valid_rows,
            "error_rows": validation.error_rows,
            "new_rows": validation.new_rows,
            "duplicate_rows": validation.duplicate_rows,
            "validation_summary": json.dumps(validation.summary, ensure_ascii=False),
            "error_report": json.dumps(validation.errors, ensure_ascii=False),
        },
    ).scalar_one()
    event_detail = {
        "status": batch_status,
        "total_rows": validation.total_rows,
        "error_rows": validation.error_rows,
    }
    record_event(db, batch_id, current_user.id, "uploaded", event_detail, request)
    if not validation.is_valid:
        record_event(db, batch_id, current_user.id, "validation_failed", event_detail, request)
    db.commit()
    return get_upload_detail(batch_id=batch_id, current_user=current_user, db=db)


@router.get("/mine", response_model=HospitalUploadListResponse)
def list_my_uploads(
    upload_status: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> HospitalUploadListResponse:
    ensure_hospital_submit(current_user)
    clauses = ["b.uploaded_by = :uploaded_by"]
    params: dict[str, Any] = {"uploaded_by": current_user.id}
    if upload_status:
        clauses.append("b.status = :status")
        params["status"] = upload_status
    where_sql = " AND ".join(clauses)
    total = db.execute(text(f"SELECT count(*) FROM hospital_upload_batches b WHERE {where_sql}"), params).scalar_one()
    rows = db.execute(
        text(BATCH_SELECT + f" WHERE {where_sql} ORDER BY b.created_at DESC, b.id DESC LIMIT :limit OFFSET :offset"),
        {**params, "limit": page_size, "offset": (page - 1) * page_size},
    ).mappings().all()
    return HospitalUploadListResponse(
        items=[HospitalUploadItem(**row) for row in rows],
        total=int(total),
        page=page,
        page_size=page_size,
    )


@router.get("/review", response_model=HospitalUploadListResponse)
def list_review_uploads(
    upload_status: str | None = Query(default=None),
    center_code: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> HospitalUploadListResponse:
    ensure_reviewer(current_user)
    clauses = ["1 = 1"]
    params: dict[str, Any] = {}
    if upload_status:
        clauses.append("b.status = :status")
        params["status"] = upload_status
    if center_code:
        clauses.append("b.center_code = :center_code")
        params["center_code"] = center_code
    where_sql = " AND ".join(clauses)
    total = db.execute(text(f"SELECT count(*) FROM hospital_upload_batches b WHERE {where_sql}"), params).scalar_one()
    rows = db.execute(
        text(BATCH_SELECT + f" WHERE {where_sql} ORDER BY b.submitted_at DESC NULLS LAST, b.created_at DESC LIMIT :limit OFFSET :offset"),
        {**params, "limit": page_size, "offset": (page - 1) * page_size},
    ).mappings().all()
    return HospitalUploadListResponse(
        items=[HospitalUploadItem(**row) for row in rows],
        total=int(total),
        page=page,
        page_size=page_size,
    )


@router.get("/{batch_id}", response_model=HospitalUploadDetail)
def get_upload_detail(
    batch_id: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> HospitalUploadDetail:
    batch = get_batch_row(db, batch_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="上传批次不存在")
    if current_user.role != "admin":
        ensure_hospital_submit(current_user)
        ensure_owner(batch, current_user)
    error_report = db.execute(
        text("SELECT error_report FROM hospital_upload_batches WHERE id = :batch_id"),
        {"batch_id": batch_id},
    ).scalar_one()
    events = db.execute(
        text(
            """
            SELECT e.event_type,
                   e.detail,
                   e.client_ip,
                   e.created_at,
                   COALESCE(u.display_name, u.username) AS actor_name
            FROM hospital_upload_events e
            LEFT JOIN users u ON u.id = e.actor_id
            WHERE e.batch_id = :batch_id
            ORDER BY e.created_at, e.id
            """
        ),
        {"batch_id": batch_id},
    ).mappings().all()
    return HospitalUploadDetail(
        batch=HospitalUploadItem(**batch),
        errors=[HospitalUploadError(**item) for item in (error_report or [])],
        events=[dict(row) for row in events],
    )


@router.get("/{batch_id}/errors.csv")
def download_errors(
    batch_id: int,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    batch = get_batch_storage_row(db, batch_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="上传批次不存在")
    if current_user.role != "admin":
        ensure_hospital_submit(current_user)
        ensure_owner(batch, current_user)
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["行号", "原始序号", "样本编码", "错误类型", "原因"])
    for item in batch["error_report"] or []:
        writer.writerow([
            item.get("row_number"),
            item.get("sample_id"),
            item.get("sample_code"),
            item.get("error_type"),
            item.get("reason"),
        ])
    return Response(
        content="\ufeff" + output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="hospital_upload_{batch_id}_errors.csv"'},
    )


@router.post("/{batch_id}/submit", response_model=HospitalUploadDetail)
def submit_upload(
    batch_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> HospitalUploadDetail:
    center_code = ensure_hospital_submit(current_user)
    batch = get_batch_storage_row(db, batch_id, for_update=True)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="上传批次不存在")
    ensure_owner(batch, current_user)
    if batch["status"] != "validated":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="已驳回批次不能再次提交，请按驳回意见修改文件后重新上传",
        )
    path = resolve_stored_path(batch["file_path"])
    with materialize_stored_file(path, batch["file_hash"]) as plaintext_path:
        validation = validate_hospital_upload(db, plaintext_path, batch["sheet_name"], center_code)
    if not validation.is_valid:
        db.execute(
            text(
                """
                UPDATE hospital_upload_batches
                SET status = 'validation_failed', total_rows = :total_rows, valid_rows = :valid_rows,
                    error_rows = :error_rows, new_rows = :new_rows, duplicate_rows = :duplicate_rows,
                    validation_summary = CAST(:summary AS jsonb), error_report = CAST(:errors AS jsonb)
                WHERE id = :batch_id
                """
            ),
            {
                "batch_id": batch_id,
                "total_rows": validation.total_rows,
                "valid_rows": validation.valid_rows,
                "error_rows": validation.error_rows,
                "new_rows": validation.new_rows,
                "duplicate_rows": validation.duplicate_rows,
                "summary": json.dumps(validation.summary, ensure_ascii=False),
                "errors": json.dumps(validation.errors, ensure_ascii=False),
            },
        )
        record_event(db, batch_id, current_user.id, "validation_failed", {"stage": "submit"}, request)
        db.commit()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="提交前重新校验未通过，请下载错误报告并重新上传")
    db.execute(
        text(
            """
            UPDATE hospital_upload_batches
            SET status = 'submitted', submitted_at = now(), reviewed_by = NULL,
                reviewed_at = NULL, review_comment = NULL, default_status = NULL,
                imported_by = NULL, imported_at = NULL, import_error = NULL
            WHERE id = :batch_id
            """
        ),
        {"batch_id": batch_id},
    )
    record_event(db, batch_id, current_user.id, "submitted", {}, request)
    db.commit()
    return get_upload_detail(batch_id=batch_id, current_user=current_user, db=db)


@router.post("/{batch_id}/cancel", response_model=HospitalUploadDetail)
def cancel_upload(
    batch_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> HospitalUploadDetail:
    ensure_hospital_submit(current_user)
    batch = get_batch_storage_row(db, batch_id, for_update=True)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="上传批次不存在")
    ensure_owner(batch, current_user)
    if batch["status"] not in {"validated", "validation_failed"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="当前批次不能撤销")
    db.execute(
        text("UPDATE hospital_upload_batches SET status = 'cancelled', cancelled_at = now() WHERE id = :batch_id"),
        {"batch_id": batch_id},
    )
    record_event(db, batch_id, current_user.id, "cancelled", {}, request)
    db.commit()
    return get_upload_detail(batch_id=batch_id, current_user=current_user, db=db)


@router.get("/{batch_id}/submission-preview", response_model=HospitalSubmissionPreviewResponse)
def preview_hospital_submission_data(
    batch_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> HospitalSubmissionPreviewResponse:
    ensure_hospital_submit(current_user)
    batch = get_batch_storage_row(db, batch_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="上传批次不存在")
    ensure_owner(batch, current_user)
    if batch["status"] not in {"validated", "validation_failed"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="当前批次已提交或已结束，不能再次进行提交前预览")
    path = resolve_stored_path(batch["file_path"])
    with materialize_stored_file(path, batch["file_hash"]) as plaintext_path:
        headers, rows, sensitive_columns, total_rows = build_hospital_submission_preview(
            plaintext_path,
            batch["sheet_name"],
        )
    record_event(
        db,
        batch_id,
        current_user.id,
        "submission_preview_viewed",
        {"displayed_rows": len(rows), "total_rows": total_rows},
        request,
    )
    db.commit()
    return HospitalSubmissionPreviewResponse(
        total_rows=total_rows,
        displayed_rows=len(rows),
        headers=headers,
        sensitive_columns=sensitive_columns,
        rows=[HospitalReviewPreviewRow(**row) for row in rows],
    )


@router.get("/{batch_id}/review-preview", response_model=HospitalReviewPreviewResponse)
def preview_hospital_review_data(
    batch_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> HospitalReviewPreviewResponse:
    ensure_reviewer(current_user)
    batch = get_batch_storage_row(db, batch_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="上传批次不存在")
    if batch["status"] not in {"submitted", "approved", "import_failed"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="当前批次状态不能进入审核预览")
    path = resolve_stored_path(batch["file_path"])
    with materialize_stored_file(path, batch["file_hash"]) as plaintext_path:
        validation = validate_hospital_upload(db, plaintext_path, batch["sheet_name"], batch["center_code"])
        if not validation.is_valid:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="批次重新校验未通过")
        assignments, date_counts = build_hospital_code_assignments(
            db,
            plaintext_path,
            batch["sheet_name"],
            batch["center_code"],
        )
        headers, rows, sensitive_columns, total_rows = build_hospital_review_preview(
            plaintext_path,
            batch["sheet_name"],
            assignments,
        )
    record_event(
        db,
        batch_id,
        current_user.id,
        "review_preview_viewed",
        {"rows": total_rows, "sensitive_columns": len(sensitive_columns)},
        request,
    )
    db.commit()
    specimen_type_counts = validation.summary.get("specimen_type_counts", {})
    return HospitalReviewPreviewResponse(
        total_rows=total_rows,
        displayed_rows=len(rows),
        headers=headers,
        sensitive_columns=sensitive_columns,
        date_counts=date_counts,
        specimen_type_counts=specimen_type_counts if isinstance(specimen_type_counts, dict) else {},
        rows=rows,
    )


@router.get("/{batch_id}/review-preview.xlsx")
def download_hospital_review_preview(
    batch_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    ensure_reviewer(current_user)
    batch = get_batch_storage_row(db, batch_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="上传批次不存在")
    if batch["status"] not in {"submitted", "approved", "import_failed"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="当前批次状态不能下载审核预览")
    path = resolve_stored_path(batch["file_path"])
    with materialize_stored_file(path, batch["file_hash"]) as plaintext_path:
        validation = validate_hospital_upload(db, plaintext_path, batch["sheet_name"], batch["center_code"])
        if not validation.is_valid:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="批次重新校验未通过")
        assignments, _ = build_hospital_code_assignments(
            db,
            plaintext_path,
            batch["sheet_name"],
            batch["center_code"],
        )
        content = build_hospital_review_preview_workbook(
            plaintext_path,
            batch["sheet_name"],
            assignments,
        )
    record_event(
        db,
        batch_id,
        current_user.id,
        "review_preview_downloaded",
        {"rows": len(assignments), "format": "xlsx"},
        request,
    )
    db.commit()
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="hospital_upload_{batch_id}_review_preview.xlsx"',
            "Cache-Control": "no-store",
            "Pragma": "no-cache",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/{batch_id}/code-preview", response_model=HospitalCodePreviewResponse)
def preview_hospital_codes(
    batch_id: int,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> HospitalCodePreviewResponse:
    ensure_reviewer(current_user)
    batch = get_batch_storage_row(db, batch_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="上传批次不存在")
    if batch["status"] not in {"submitted", "approved", "import_failed"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="当前批次状态不能预览正式编码")
    path = resolve_stored_path(batch["file_path"])
    with materialize_stored_file(path, batch["file_hash"]) as plaintext_path:
        validation = validate_hospital_upload(db, plaintext_path, batch["sheet_name"], batch["center_code"])
        if not validation.is_valid:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="批次重新校验未通过")
        assignments, date_counts = build_hospital_code_assignments(
            db,
            plaintext_path,
            batch["sheet_name"],
            batch["center_code"],
        )
    return HospitalCodePreviewResponse(
        total_rows=len(assignments),
        date_counts=date_counts,
        rows=[
            HospitalCodePreviewRow(
                row_number=assignment.row_number,
                sample_id=assignment.sample_id,
                collection_date=assignment.collection_date,
                specimen_type=assignment.specimen_type,
                sample_code=assignment.sample_code,
            )
            for assignment in assignments[:200]
        ],
    )


@router.get("/{batch_id}/code-preview.csv")
def download_hospital_code_preview(
    batch_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    ensure_reviewer(current_user)
    batch = get_batch_storage_row(db, batch_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="上传批次不存在")
    if batch["status"] not in {"submitted", "approved", "import_failed"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="当前批次状态不能下载编码预览")
    path = resolve_stored_path(batch["file_path"])
    with materialize_stored_file(path, batch["file_hash"]) as plaintext_path:
        validation = validate_hospital_upload(db, plaintext_path, batch["sheet_name"], batch["center_code"])
        if not validation.is_valid:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="批次重新校验未通过")
        assignments, _ = build_hospital_code_assignments(
            db,
            plaintext_path,
            batch["sheet_name"],
            batch["center_code"],
        )
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["Excel 行", "医院原始序号", "采集日期", "样本类型", "平台正式编码"])
    for assignment in assignments:
        writer.writerow([
            assignment.row_number,
            assignment.sample_id,
            assignment.collection_date,
            assignment.specimen_type,
            assignment.sample_code,
        ])
    record_event(
        db,
        batch_id,
        current_user.id,
        "preview_downloaded",
        {"rows": len(assignments)},
        request,
    )
    db.commit()
    return Response(
        content="\ufeff" + output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="hospital_upload_{batch_id}_code_preview.csv"'},
    )


@router.post("/{batch_id}/review", response_model=HospitalUploadDetail)
def review_upload(
    batch_id: int,
    payload: HospitalReviewRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> HospitalUploadDetail:
    ensure_reviewer(current_user)
    batch = get_batch_storage_row(db, batch_id, for_update=True)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="上传批次不存在")
    if batch["status"] != "submitted":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="只有待审核批次可以复核")
    comment = (payload.comment or "").strip()
    if payload.action == "reject":
        if len(comment) < 2:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="驳回时请填写原因")
        db.execute(
            text(
                """
                UPDATE hospital_upload_batches
                SET status = 'rejected', reviewed_by = :reviewed_by, reviewed_at = now(),
                    review_comment = :review_comment
                WHERE id = :batch_id
                """
            ),
            {"batch_id": batch_id, "reviewed_by": current_user.id, "review_comment": comment},
        )
        record_event(db, batch_id, current_user.id, "rejected", {"comment": comment}, request)
        db.commit()
        return get_upload_detail(batch_id=batch_id, current_user=current_user, db=db)

    path = resolve_stored_path(batch["file_path"])
    with materialize_stored_file(path, batch["file_hash"]) as plaintext_path:
        validation = validate_hospital_upload(db, plaintext_path, batch["sheet_name"], batch["center_code"])
    if not validation.is_valid:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="审核时重新校验未通过，数据可能已发生变化",
        )
    db.execute(
        text(
            """
            UPDATE hospital_upload_batches
            SET status = 'approved', reviewed_by = :reviewed_by, reviewed_at = now(),
                review_comment = :review_comment, default_status = NULL,
                import_batch_id = NULL, imported_by = NULL, imported_at = NULL,
                import_error = NULL
            WHERE id = :batch_id
            """
        ),
        {
            "batch_id": batch_id,
            "reviewed_by": current_user.id,
            "review_comment": comment or None,
        },
    )
    record_event(
        db,
        batch_id,
        current_user.id,
        "approved",
        {"comment": comment or None},
        request,
    )
    db.commit()
    return get_upload_detail(batch_id=batch_id, current_user=current_user, db=db)


@router.post("/{batch_id}/import", response_model=HospitalUploadDetail)
def import_approved_upload(
    batch_id: int,
    payload: HospitalImportRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> HospitalUploadDetail:
    ensure_reviewer(current_user)
    batch = get_batch_storage_row(db, batch_id, for_update=True)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="上传批次不存在")
    if batch["status"] not in {"approved", "import_failed"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="只有审核通过的批次可以正式导入")
    if payload.default_status not in ALLOWED_REVIEW_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无效的新样本初始状态")
    path = resolve_stored_path(batch["file_path"])
    try:
        with materialize_stored_file(path, batch["file_hash"]) as plaintext_path:
            validation = validate_hospital_upload(db, plaintext_path, batch["sheet_name"], batch["center_code"])
            if not validation.is_valid:
                raise ValueError("正式导入前重新校验未通过，数据可能已发生变化")
            assignments, date_counts = build_hospital_code_assignments(
                db,
                plaintext_path,
                batch["sheet_name"],
                batch["center_code"],
                lock_center=True,
            )
            result = import_excel_file(
                db=db,
                path=plaintext_path,
                sheet_name=batch["sheet_name"],
                uploaded_by=batch["uploaded_by"],
                original_file_name=batch["file_name"],
                default_status=payload.default_status,
                center_code=batch["center_code"],
                allow_nonstandard=True,
                require_sample_code=False,
                duplicate_strategy="error",
                atomic=True,
                commit=False,
                sample_codes_by_row={
                    assignment.row_number: assignment.sample_code
                    for assignment in assignments
                },
            )
        db.execute(
            text(
                """
                UPDATE hospital_upload_batches
                SET status = 'imported', import_batch_id = :import_batch_id,
                    imported_by = :imported_by, imported_at = now(), import_error = NULL,
                    default_status = :default_status
                WHERE id = :batch_id
                """
            ),
            {
                "batch_id": batch_id,
                "import_batch_id": result.import_batch_id,
                "imported_by": current_user.id,
                "default_status": payload.default_status,
            },
        )
        record_event(
            db,
            batch_id,
            current_user.id,
            "imported",
            {
                "import_batch_id": result.import_batch_id,
                "success_rows": result.success_rows,
                "generated_code_counts": date_counts,
                "default_status": payload.default_status,
            },
            request,
        )
        db.commit()
    except (DuplicateSampleCodeError, AtomicImportError, ValueError) as exc:
        db.rollback()
        db.execute(
            text(
                """
                UPDATE hospital_upload_batches
                SET status = 'import_failed', imported_by = :imported_by,
                    imported_at = now(), import_error = :import_error,
                    default_status = :default_status
                WHERE id = :batch_id
                """
            ),
            {
                "batch_id": batch_id,
                "imported_by": current_user.id,
                "import_error": str(exc)[:1000],
                "default_status": payload.default_status,
            },
        )
        record_event(db, batch_id, current_user.id, "import_failed", {"reason": str(exc)[:500]}, request)
        db.commit()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except Exception:
        db.rollback()
        logger.exception("医院上传批次正式导入失败")
        db.execute(
            text(
                """
                UPDATE hospital_upload_batches
                SET status = 'import_failed', imported_by = :imported_by,
                    imported_at = now(), import_error = '系统处理失败，请联系管理员',
                    default_status = :default_status
                WHERE id = :batch_id
                """
            ),
            {
                "batch_id": batch_id,
                "imported_by": current_user.id,
                "default_status": payload.default_status,
            },
        )
        record_event(db, batch_id, current_user.id, "import_failed", {"reason": "system_error"}, request)
        db.commit()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="正式导入失败，请稍后重试") from None
    return get_upload_detail(batch_id=batch_id, current_user=current_user, db=db)
