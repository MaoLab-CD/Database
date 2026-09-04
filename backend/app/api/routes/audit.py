from __future__ import annotations

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.db.session import get_db

router = APIRouter()


class AuditSummary(BaseModel):
    private_access_count: int


class PrivateAccessLogItem(BaseModel):
    id: int
    sample_pk: int | None = None
    sample_id: str
    sample_code: str | None = None
    viewer_id: int
    viewer_name: str | None = None
    viewer_username: str | None = None
    viewer_role: str
    viewed_fields: list[str]
    view_reason: str | None = None
    access_type: str
    ip_address: str | None = None
    device_info: str | None = None
    created_at: datetime


class PrivateAccessLogResponse(BaseModel):
    items: list[PrivateAccessLogItem]
    total: int
    page: int
    page_size: int


def ensure_audit_viewer(current_user: CurrentUser) -> None:
    if current_user.role == "admin":
        return
    if current_user.permissions.get("privacy_access_log_view"):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="当前账号没有查看隐私访问日志权限",
    )


def build_private_filters(
    keyword: str | None,
    access_type: str | None,
) -> tuple[str, dict[str, Any]]:
    clauses = ["1 = 1"]
    params: dict[str, Any] = {}

    if keyword:
        clauses.append(
            """
            (
                l.sample_id ILIKE :keyword
                OR COALESCE(l.sample_code, '') ILIKE :keyword
                OR COALESCE(u.username, '') ILIKE :keyword
                OR COALESCE(u.display_name, '') ILIKE :keyword
                OR COALESCE(l.view_reason, '') ILIKE :keyword
                OR COALESCE(l.ip_address, '') ILIKE :keyword
            )
            """
        )
        params["keyword"] = f"%{keyword.strip()}%"

    if access_type:
        if access_type not in {"view", "export"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无效的访问类型")
        clauses.append("l.access_type = :access_type")
        params["access_type"] = access_type

    return " AND ".join(clauses), params


@router.get("/summary", response_model=AuditSummary)
def get_audit_summary(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> AuditSummary:
    ensure_audit_viewer(current_user)

    private_access_count = db.execute(
        text("SELECT count(*) FROM private_info_access_logs")
    ).scalar_one()

    return AuditSummary(
        private_access_count=int(private_access_count),
    )


@router.get("/private-access", response_model=PrivateAccessLogResponse)
def list_private_access_logs(
    keyword: str | None = Query(default=None),
    access_type: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> PrivateAccessLogResponse:
    ensure_audit_viewer(current_user)
    where_sql, params = build_private_filters(keyword, access_type)
    offset = (page - 1) * page_size

    total = db.execute(
        text(
            f"""
            SELECT count(*)
            FROM private_info_access_logs l
            LEFT JOIN users u ON u.id = l.viewer_id
            WHERE {where_sql}
            """
        ),
        params,
    ).scalar_one()

    rows = (
        db.execute(
            text(
                f"""
                SELECT l.id,
                       l.sample_pk,
                       l.sample_id,
                       l.sample_code,
                       l.viewer_id,
                       COALESCE(u.display_name, u.username) AS viewer_name,
                       u.username AS viewer_username,
                       l.viewer_role,
                       l.viewed_fields,
                       l.view_reason,
                       l.access_type,
                       l.ip_address,
                       l.device_info,
                       l.created_at
                FROM private_info_access_logs l
                LEFT JOIN users u ON u.id = l.viewer_id
                WHERE {where_sql}
                ORDER BY l.created_at DESC, l.id DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {**params, "limit": page_size, "offset": offset},
        )
        .mappings()
        .all()
    )

    return PrivateAccessLogResponse(
        items=[PrivateAccessLogItem(**row) for row in rows],
        total=int(total),
        page=page,
        page_size=page_size,
    )
