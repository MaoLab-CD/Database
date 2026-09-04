from __future__ import annotations

import hmac
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Literal
from urllib.parse import quote
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.db.session import get_db
from app.services.login_rate_limit import client_ip_from_request
from app.services.secure_document_storage import (
    ENCRYPTED_FILE_SUFFIX,
    MAX_PDF_BYTES,
    SecureDocumentDecryptionError,
    read_encrypted_document,
    resolve_document_path,
    sha256_bytes,
    validate_pdf_content,
    write_encrypted_document,
)


router = APIRouter()

DocumentType = Literal["organoid_report", "informed_consent_bundle", "other"]
ScopeType = Literal["sample", "collection"]


class SecureDocumentItem(BaseModel):
    id: int
    document_type: str
    scope_type: str
    sample_pk: int | None = None
    sample_code: str | None = None
    specimen_type: str | None = None
    center_code: str | None = None
    center_name: str | None = None
    title: str
    coverage_note: str | None = None
    original_file_name: str
    mime_type: str
    file_size: int
    file_sha256: str
    uploaded_by: int
    uploaded_by_name: str | None = None
    created_at: datetime


class SecureDocumentListResponse(BaseModel):
    items: list[SecureDocumentItem]
    total: int
    page: int
    page_size: int


DOCUMENT_SELECT = """
    SELECT d.id,
           d.document_type,
           d.scope_type,
           d.sample_pk,
           s.sample_code,
           s.specimen_type,
           d.center_code,
           c.center_name,
           d.title,
           d.coverage_note,
           d.original_file_name,
           d.relative_path,
           d.mime_type,
           d.file_size,
           d.file_sha256,
           d.uploaded_by,
           u.display_name AS uploaded_by_name,
           d.created_at
    FROM secure_documents d
    LEFT JOIN samples s ON s.id = d.sample_pk
    LEFT JOIN centers c ON c.center_code = d.center_code
    LEFT JOIN users u ON u.id = d.uploaded_by
"""


def ensure_admin(current_user: CurrentUser) -> None:
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有管理员可以管理敏感资料")


def safe_file_name(file_name: str) -> str:
    name = Path(file_name).name
    return re.sub(r"[^0-9A-Za-z\u4e00-\u9fff._-]+", "_", name).strip("._") or "document.pdf"


def request_ip(request: Request) -> str | None:
    return client_ip_from_request(request)


def record_event(
    db: Session,
    document_id: int,
    actor_id: int | None,
    event_type: str,
    request: Request,
    detail: dict | None = None,
) -> None:
    db.execute(
        text(
            """
            INSERT INTO secure_document_events (
                document_id, actor_id, event_type, detail, client_ip
            )
            VALUES (
                :document_id, :actor_id, :event_type,
                CAST(:detail AS jsonb), :client_ip
            )
            """
        ),
        {
            "document_id": document_id,
            "actor_id": actor_id,
            "event_type": event_type,
            "detail": json.dumps(detail or {}, ensure_ascii=False),
            "client_ip": request_ip(request),
        },
    )


def get_document_row(db: Session, document_id: int) -> dict:
    row = (
        db.execute(
            text(
                DOCUMENT_SELECT
                + """
                  WHERE d.id = :document_id
                    AND d.is_deleted = false
                """
            ),
            {"document_id": document_id},
        )
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="资料不存在")
    return dict(row)


@router.get("", response_model=SecureDocumentListResponse)
def list_documents(
    scope_type: ScopeType | None = Query(default=None),
    sample_pk: int | None = Query(default=None, ge=1),
    document_type: DocumentType | None = Query(default=None),
    keyword: str | None = Query(default=None, max_length=128),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> SecureDocumentListResponse:
    ensure_admin(current_user)
    clauses = ["d.is_deleted = false"]
    params: dict[str, object] = {}
    if scope_type:
        clauses.append("d.scope_type = :scope_type")
        params["scope_type"] = scope_type
    if sample_pk:
        clauses.append("d.sample_pk = :sample_pk")
        params["sample_pk"] = sample_pk
    if document_type:
        clauses.append("d.document_type = :document_type")
        params["document_type"] = document_type
    if keyword and keyword.strip():
        clauses.append(
            "(d.title ILIKE :keyword OR d.original_file_name ILIKE :keyword "
            "OR COALESCE(d.coverage_note, '') ILIKE :keyword "
            "OR COALESCE(c.center_name, '') ILIKE :keyword)"
        )
        params["keyword"] = f"%{keyword.strip()}%"
    where_sql = " AND ".join(clauses)
    total = db.execute(
        text(
            """
            SELECT count(*)
            FROM secure_documents d
            LEFT JOIN centers c ON c.center_code = d.center_code
            WHERE """
            + where_sql
        ),
        params,
    ).scalar_one()
    params.update({"limit": page_size, "offset": (page - 1) * page_size})
    rows = db.execute(
        text(
            DOCUMENT_SELECT
            + " WHERE "
            + where_sql
            + " ORDER BY d.created_at DESC, d.id DESC LIMIT :limit OFFSET :offset"
        ),
        params,
    ).mappings().all()
    return SecureDocumentListResponse(
        items=[SecureDocumentItem(**dict(row)) for row in rows],
        total=int(total),
        page=page,
        page_size=page_size,
    )


@router.post("/upload", response_model=SecureDocumentItem)
async def upload_document(
    request: Request,
    file: UploadFile = File(...),
    document_type: DocumentType = Form(...),
    scope_type: ScopeType = Form(...),
    title: str | None = Form(default=None, max_length=255),
    coverage_note: str | None = Form(default=None, max_length=2000),
    sample_pk: int | None = Form(default=None),
    center_code: str | None = Form(default=None, max_length=32),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> SecureDocumentItem:
    ensure_admin(current_user)
    original_name = safe_file_name(file.filename or "document.pdf")
    if Path(original_name).suffix.lower() != ".pdf":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="仅支持 PDF 文件")
    if scope_type == "sample" and sample_pk is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="样本资料必须关联具体样本")
    if scope_type == "collection" and sample_pk is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="汇总资料不能绑定单个样本")
    if document_type == "organoid_report" and scope_type != "sample":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="类器官报告必须关联具体样本")
    if document_type == "informed_consent_bundle" and scope_type != "collection":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="合并知情同意书应作为汇总资料上传")

    if sample_pk is not None:
        sample = db.execute(
            text(
                """
                SELECT id, sample_code, specimen_type, center_code
                FROM samples
                WHERE id = :sample_pk AND is_deleted = false
                """
            ),
            {"sample_pk": sample_pk},
        ).mappings().first()
        if sample is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="关联样本不存在")
        if document_type == "organoid_report" and sample["specimen_type"] != "类器官":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="类器官构建报告只能关联类器官样本")
        center_code = center_code or sample["center_code"]

    if center_code:
        center_exists = db.execute(
            text("SELECT 1 FROM centers WHERE center_code = :center_code"),
            {"center_code": center_code},
        ).scalar_one_or_none()
        if center_exists is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="所选中心不存在")

    content = await file.read(MAX_PDF_BYTES + 1)
    try:
        validate_pdf_content(content)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    file_hash = sha256_bytes(content)
    duplicate = db.execute(
        text(
            """
            SELECT id
            FROM secure_documents
            WHERE is_deleted = false
              AND file_sha256 = :file_hash
              AND scope_type = :scope_type
              AND sample_pk IS NOT DISTINCT FROM :sample_pk
            LIMIT 1
            """
        ),
        {"file_hash": file_hash, "scope_type": scope_type, "sample_pk": sample_pk},
    ).scalar_one_or_none()
    if duplicate is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="相同 PDF 已经上传，请勿重复提交")

    now = datetime.now()
    stored_name = f"{uuid4().hex}{ENCRYPTED_FILE_SUFFIX}"
    relative_path = f"{now:%Y/%m}/{stored_name}"
    target_path = resolve_document_path(relative_path)
    write_encrypted_document(target_path, content)
    try:
        document_id = db.execute(
            text(
                """
                INSERT INTO secure_documents (
                    document_type, scope_type, sample_pk, center_code,
                    title, coverage_note, original_file_name, stored_file_name,
                    relative_path, mime_type, file_size, file_sha256,
                    encryption_version, uploaded_by
                )
                VALUES (
                    :document_type, :scope_type, :sample_pk, :center_code,
                    :title, :coverage_note, :original_file_name, :stored_file_name,
                    :relative_path, 'application/pdf', :file_size, :file_sha256,
                    1, :uploaded_by
                )
                RETURNING id
                """
            ),
            {
                "document_type": document_type,
                "scope_type": scope_type,
                "sample_pk": sample_pk,
                "center_code": center_code or None,
                "title": (title or Path(original_name).stem).strip()[:255],
                "coverage_note": coverage_note.strip() if coverage_note else None,
                "original_file_name": original_name,
                "stored_file_name": stored_name,
                "relative_path": relative_path,
                "file_size": len(content),
                "file_sha256": file_hash,
                "uploaded_by": current_user.id,
            },
        ).scalar_one()
        record_event(db, document_id, current_user.id, "uploaded", request, {"file_sha256": file_hash})
        db.commit()
    except Exception:
        db.rollback()
        target_path.unlink(missing_ok=True)
        raise
    return SecureDocumentItem(**get_document_row(db, document_id))


def document_content_response(
    document_id: int,
    disposition: Literal["inline", "attachment"],
    request: Request,
    db: Session,
    current_user: CurrentUser,
) -> Response:
    ensure_admin(current_user)
    row = get_document_row(db, document_id)
    try:
        path = resolve_document_path(row["relative_path"])
        if not path.is_file():
            raise FileNotFoundError
        content = read_encrypted_document(path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="加密资料文件不存在") from exc
    except (ValueError, SecureDocumentDecryptionError) as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if not hmac.compare_digest(sha256_bytes(content), row["file_sha256"]):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="资料文件完整性校验失败")
    event_type = "previewed" if disposition == "inline" else "downloaded"
    record_event(db, document_id, current_user.id, event_type, request)
    db.commit()
    encoded_name = quote(row["original_file_name"])
    return Response(
        content=content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"{disposition}; filename*=UTF-8''{encoded_name}",
            "Cache-Control": "no-store, private, max-age=0",
            "Pragma": "no-cache",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
        },
    )


@router.get("/{document_id}/preview")
def preview_document(
    document_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    return document_content_response(document_id, "inline", request, db, current_user)


@router.get("/{document_id}/download")
def download_document(
    document_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    return document_content_response(document_id, "attachment", request, db, current_user)


@router.delete("/{document_id}")
def delete_document(
    document_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, bool]:
    ensure_admin(current_user)
    row = get_document_row(db, document_id)
    db.execute(
        text(
            """
            UPDATE secure_documents
            SET is_deleted = true,
                deleted_by = :deleted_by,
                deleted_at = now()
            WHERE id = :document_id
              AND is_deleted = false
            """
        ),
        {"document_id": document_id, "deleted_by": current_user.id},
    )
    record_event(db, document_id, current_user.id, "deleted", request)
    db.commit()
    try:
        resolve_document_path(row["relative_path"]).unlink(missing_ok=True)
    except OSError:
        pass
    return {"ok": True}
