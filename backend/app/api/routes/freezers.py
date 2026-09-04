from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.db.session import get_db
from app.services.storage_freezers import build_freezer_label

router = APIRouter()


class FreezerItem(BaseModel):
    id: int
    freezer_code: str
    temperature_c: float
    display_name: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class FreezerRequest(BaseModel):
    freezer_code: str = Field(
        min_length=1,
        max_length=64,
        pattern=r"^\d{3}-\d{2}$",
    )
    temperature_c: float = Field(ge=-196, le=100)
    is_active: bool = True


def ensure_admin(current_user: CurrentUser) -> None:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="没有冰箱管理权限",
        )


def serialize_freezer(row: dict) -> FreezerItem:
    payload = dict(row)
    payload["display_name"] = build_freezer_label(
        payload["freezer_code"],
        payload["temperature_c"],
    )
    return FreezerItem(**payload)


@router.get("", response_model=list[FreezerItem])
def list_freezers(
    active_only: bool = Query(default=True),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[FreezerItem]:
    ensure_admin(current_user)
    rows = (
        db.execute(
            text(
                """
                SELECT id,
                       freezer_code,
                       temperature_c::float8 AS temperature_c,
                       is_active,
                       created_at,
                       updated_at
                FROM storage_freezers
                WHERE (:active_only = false OR is_active = true)
                ORDER BY freezer_code, id
                """
            ),
            {"active_only": active_only},
        )
        .mappings()
        .all()
    )
    return [serialize_freezer(dict(row)) for row in rows]


@router.post("", response_model=FreezerItem)
def create_freezer(
    payload: FreezerRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> FreezerItem:
    ensure_admin(current_user)
    try:
        row = (
            db.execute(
                text(
                    """
                    INSERT INTO storage_freezers (
                        freezer_code,
                        temperature_c,
                        is_active
                    )
                    VALUES (
                        :freezer_code,
                        :temperature_c,
                        :is_active
                    )
                    RETURNING id,
                              freezer_code,
                              temperature_c::float8 AS temperature_c,
                              is_active,
                              created_at,
                              updated_at
                    """
                ),
                {
                    "freezer_code": payload.freezer_code.strip().upper(),
                    "temperature_c": payload.temperature_c,
                    "is_active": payload.is_active,
                },
            )
            .mappings()
            .one()
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="冰箱编号已存在",
        )
    return serialize_freezer(dict(row))


@router.put("/{freezer_id}", response_model=FreezerItem)
def update_freezer(
    freezer_id: int,
    payload: FreezerRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> FreezerItem:
    ensure_admin(current_user)
    try:
        row = (
            db.execute(
                text(
                    """
                    UPDATE storage_freezers
                    SET freezer_code = :freezer_code,
                        temperature_c = :temperature_c,
                        is_active = :is_active,
                        updated_at = now()
                    WHERE id = :freezer_id
                    RETURNING id,
                              freezer_code,
                              temperature_c::float8 AS temperature_c,
                              is_active,
                              created_at,
                              updated_at
                    """
                ),
                {
                    "freezer_id": freezer_id,
                    "freezer_code": payload.freezer_code.strip().upper(),
                    "temperature_c": payload.temperature_c,
                    "is_active": payload.is_active,
                },
            )
            .mappings()
            .first()
        )
        if row is None:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="冰箱不存在",
            )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="冰箱编号已存在",
        )
    return serialize_freezer(dict(row))
