from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.db.session import get_db
from app.services.sample_code_excel import add_sample_codes_to_excel
from app.services.specimen_types import get_active_specimen_type_names


router = APIRouter()
ALLOWED_SUFFIXES = {".xls", ".xlsx", ".xlsm"}


class ExcelCodePreviewRow(BaseModel):
    row_number: int
    collection_date: str
    sample_code: str
    assignment_source: str


class ExcelCodePreviewResult(BaseModel):
    total_count: int
    generated_count: int
    reused_count: int
    provided_count: int
    date_counts: dict[str, int]
    rows: list[ExcelCodePreviewRow]


def ensure_batch_code_access(current_user: CurrentUser) -> None:
    if current_user.role != "admin" and not current_user.permissions.get("batch_code_generate"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="没有批量打码权限",
        )


@router.post("/excel")
async def generate_excel_sample_codes(
    file: UploadFile = File(...),
    sheet_name: str = Form(...),
    center_code: str = Form(...),
    sample_type: str = Form("全血"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    ensure_batch_code_access(current_user)
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="仅支持 .xls / .xlsx / .xlsm 文件",
        )
    allowed_types = get_active_specimen_type_names(db, batch_code_only=True)
    if sample_type not in allowed_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="样本类型未启用批量打码或编码规则尚未确认",
        )

    center_exists = db.execute(
        text(
            """
            SELECT 1
            FROM centers
            WHERE center_code = :center_code
              AND is_active = true
            """
        ),
        {"center_code": center_code},
    ).scalar_one_or_none()
    if center_exists is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="中心不存在或已停用",
        )

    content = await file.read()
    try:
        output, counts, source_counts, _ = add_sample_codes_to_excel(
            content=content,
            sheet_name=sheet_name,
            center_code=center_code,
            sample_type=sample_type,
            db=db,
            keep_vba=suffix == ".xlsm",
            source_suffix=suffix,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    original_stem = Path(file.filename or "samples").stem
    output_suffix = ".xlsx" if suffix == ".xls" else suffix
    output_name = f"{original_stem}_filled{output_suffix}"
    return Response(
        content=output,
        media_type=(
            "application/vnd.ms-excel.sheet.macroEnabled.12"
            if output_suffix == ".xlsm"
            else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ),
        headers={
            "Content-Disposition": (
                f"attachment; filename*=UTF-8''{quote(output_name)}"
            ),
            "X-Generated-Count": str(sum(counts.values())),
            "X-New-Count": str(source_counts.get("generated", 0)),
            "X-Reused-Count": str(source_counts.get("reused", 0)),
            "X-Preserved-Count": str(source_counts.get("provided", 0)),
            "X-Date-Counts": quote(json.dumps(counts, ensure_ascii=False)),
        },
    )


@router.post("/excel/preview", response_model=ExcelCodePreviewResult)
async def preview_excel_sample_codes(
    file: UploadFile = File(...),
    sheet_name: str = Form(...),
    center_code: str = Form(...),
    sample_type: str = Form("全血"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ExcelCodePreviewResult:
    ensure_batch_code_access(current_user)
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="仅支持 .xls / .xlsx / .xlsm 文件",
        )
    allowed_types = get_active_specimen_type_names(db, batch_code_only=True)
    if sample_type not in allowed_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="样本类型未启用批量打码或编码规则尚未确认",
        )

    center_exists = db.execute(
        text(
            """
            SELECT 1
            FROM centers
            WHERE center_code = :center_code
              AND is_active = true
            """
        ),
        {"center_code": center_code},
    ).scalar_one_or_none()
    if center_exists is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="中心不存在或已停用",
        )

    try:
        _, counts, source_counts, rows = add_sample_codes_to_excel(
            content=await file.read(),
            sheet_name=sheet_name,
            center_code=center_code,
            sample_type=sample_type,
            db=db,
            keep_vba=suffix == ".xlsm",
            source_suffix=suffix,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    return ExcelCodePreviewResult(
        total_count=sum(counts.values()),
        generated_count=source_counts.get("generated", 0),
        reused_count=source_counts.get("reused", 0),
        provided_count=source_counts.get("provided", 0),
        date_counts=counts,
        rows=[ExcelCodePreviewRow(**row) for row in rows],
    )
