from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.db.session import get_db

router = APIRouter()

VISIBLE_ACTIONS = {"checkout", "return_request", "return_confirm"}


class MovementRecordItem(BaseModel):
    id: int
    sample_pk: int | None = None
    sample_id: str | None = None
    sample_code: str | None = None
    action_type: str
    before_status: str | None = None
    after_status: str | None = None
    before_location: str | None = None
    after_location: str | None = None
    operator_id: int | None = None
    operator_name: str | None = None
    operator_role: str | None = None
    related_record_id: int | None = None
    note: str | None = None
    created_at: datetime
    barcode_no: str | None = None
    patient_no: str | None = None
    ethnicity: str | None = None
    department: str | None = None
    specimen_type: str | None = None


class MovementRecordResponse(BaseModel):
    items: list[MovementRecordItem]
    total: int
    page: int
    page_size: int


def ensure_record_viewer(current_user: CurrentUser) -> None:
    if current_user.role == "admin":
        return
    if current_user.permissions.get("usage_record_create"):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="当前账号没有查看出入库记录权限",
    )


def build_filters(
    keyword: str | None,
    action_type: str | None,
) -> tuple[str, dict[str, Any]]:
    clauses = ["m.action_type IN ('checkout', 'return_request', 'return_confirm')"]
    params: dict[str, Any] = {}

    if keyword:
        clauses.append(
            """
            (
                COALESCE(m.sample_id, '') ILIKE :keyword
                OR COALESCE(m.sample_code, '') ILIKE :keyword
                OR COALESCE(s.sample_code, '') ILIKE :keyword
                OR COALESCE(s.barcode_no, '') ILIKE :keyword
                OR COALESCE(s.patient_no, '') ILIKE :keyword
                OR COALESCE(s.ethnicity, '') ILIKE :keyword
                OR COALESCE(s.department, '') ILIKE :keyword
                OR COALESCE(u.display_name, '') ILIKE :keyword
                OR COALESCE(u.username, '') ILIKE :keyword
            )
            """
        )
        params["keyword"] = f"%{keyword.strip()}%"

    if action_type:
        if action_type not in VISIBLE_ACTIONS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无效的操作类型")
        clauses.append("m.action_type = :action_type")
        params["action_type"] = action_type

    return " AND ".join(clauses), params


@router.get("/movements", response_model=MovementRecordResponse)
def list_movement_records(
    keyword: str | None = Query(default=None),
    action_type: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> MovementRecordResponse:
    ensure_record_viewer(current_user)

    where_sql, params = build_filters(keyword, action_type)
    offset = (page - 1) * page_size

    total = db.execute(
        text(
            f"""
            SELECT count(*)
            FROM sample_movement_logs m
            LEFT JOIN samples s ON s.id = m.sample_pk
            LEFT JOIN users u ON u.id = m.operator_id
            WHERE {where_sql}
            """
        ),
        params,
    ).scalar_one()

    rows = (
        db.execute(
            text(
                f"""
                SELECT m.id,
                       m.sample_pk,
                       m.sample_id,
                       COALESCE(m.sample_code, s.sample_code) AS sample_code,
                       m.action_type,
                       m.before_status,
                       m.after_status,
                       m.before_location,
                       m.after_location,
                       m.operator_id,
                       COALESCE(u.display_name, u.username) AS operator_name,
                       m.operator_role,
                       m.related_record_id,
                       m.note,
                       m.created_at,
                       s.barcode_no,
                       s.patient_no,
                       s.ethnicity,
                       s.department,
                       s.specimen_type
                FROM sample_movement_logs m
                LEFT JOIN samples s ON s.id = m.sample_pk
                LEFT JOIN users u ON u.id = m.operator_id
                WHERE {where_sql}
                ORDER BY m.created_at DESC, m.id DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {**params, "limit": page_size, "offset": offset},
        )
        .mappings()
        .all()
    )

    return MovementRecordResponse(
        items=[MovementRecordItem(**row) for row in rows],
        total=int(total),
        page=page,
        page_size=page_size,
    )
