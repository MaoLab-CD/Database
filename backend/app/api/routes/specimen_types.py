from __future__ import annotations

import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.db.session import get_db
from app.services.sample_codes import BASE_SPECIMEN_TYPE


router = APIRouter()


class SpecimenTypeItem(BaseModel):
    id: int
    name: str
    is_active: bool
    allow_batch_code: bool
    uses_plate_wells: bool
    code_suffix: str | None = None
    code_rule_confirmed: bool
    code_rule_locked: bool
    sample_count: int
    sort_order: int
    note: str | None = None
    created_at: datetime
    updated_at: datetime


class CreateSpecimenTypeRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    is_active: bool = True
    allow_batch_code: bool = False
    uses_plate_wells: bool = False
    code_suffix: str | None = Field(default=None, max_length=1)
    code_rule_confirmed: bool = False
    sort_order: int = Field(default=0, ge=0, le=9999)
    note: str | None = Field(default=None, max_length=255)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("样本类型名称不能为空")
        return normalized


class UpdateSpecimenTypeRequest(BaseModel):
    is_active: bool
    allow_batch_code: bool
    uses_plate_wells: bool
    code_suffix: str | None = Field(default=None, max_length=1)
    code_rule_confirmed: bool
    sort_order: int = Field(ge=0, le=9999)
    note: str | None = Field(default=None, max_length=255)


def ensure_admin(current_user: CurrentUser) -> None:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="没有样本类型管理权限",
        )


def normalize_code_rule(
    *,
    name: str,
    code_rule_confirmed: bool,
    code_suffix: str | None,
    allow_batch_code: bool,
) -> str | None:
    if not code_rule_confirmed:
        if allow_batch_code:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="编码规则未确认，不能参与批量打码",
            )
        return None

    normalized = "" if code_suffix is None else code_suffix.strip()
    if name == BASE_SPECIMEN_TYPE:
        if normalized:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="全血是基础样本类型，编码不使用后缀",
            )
        return ""
    if not re.fullmatch(r"[A-Za-z]", normalized):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="已确认的派生样本编码后缀必须是一个英文字母，并区分大小写",
        )
    return normalized


@router.get("", response_model=list[SpecimenTypeItem])
def list_specimen_types(
    active_only: bool = Query(default=True),
    batch_code_only: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[SpecimenTypeItem]:
    rows = (
        db.execute(
            text(
                """
                SELECT st.id, st.name, st.is_active, st.allow_batch_code,
                       st.uses_plate_wells, st.code_suffix,
                       st.code_rule_confirmed, st.sort_order, st.note,
                       st.created_at, st.updated_at,
                       count(s.id)::int AS sample_count,
                       (count(s.id) > 0) AS code_rule_locked
                FROM specimen_types st
                LEFT JOIN samples s ON s.specimen_type = st.name
                WHERE (:active_only = false OR st.is_active = true)
                  AND (
                      :batch_code_only = false
                      OR (st.allow_batch_code = true AND st.code_rule_confirmed = true)
                  )
                GROUP BY st.id
                ORDER BY st.sort_order, st.id
                """
            ),
            {
                "active_only": active_only,
                "batch_code_only": batch_code_only,
            },
        )
        .mappings()
        .all()
    )
    return [SpecimenTypeItem(**row) for row in rows]


@router.post("", response_model=SpecimenTypeItem)
def create_specimen_type(
    payload: CreateSpecimenTypeRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> SpecimenTypeItem:
    ensure_admin(current_user)
    values = payload.model_dump()
    values["code_suffix"] = normalize_code_rule(
        name=payload.name,
        code_rule_confirmed=payload.code_rule_confirmed,
        code_suffix=payload.code_suffix,
        allow_batch_code=payload.allow_batch_code,
    )
    try:
        row = (
            db.execute(
                text(
                    """
                    INSERT INTO specimen_types (
                        name, is_active, allow_batch_code, uses_plate_wells,
                        code_suffix, code_rule_confirmed, sort_order, note
                    )
                    VALUES (
                        :name, :is_active, :allow_batch_code, :uses_plate_wells,
                        :code_suffix, :code_rule_confirmed, :sort_order, :note
                    )
                    RETURNING id, name, is_active, allow_batch_code,
                              uses_plate_wells, code_suffix,
                              code_rule_confirmed, sort_order, note,
                              created_at, updated_at
                    """
                ),
                values,
            )
            .mappings()
            .one()
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="样本类型名称或已确认的编码后缀已存在",
        )
    return SpecimenTypeItem(**row, sample_count=0, code_rule_locked=False)


@router.put("/{specimen_type_id}", response_model=SpecimenTypeItem)
def update_specimen_type(
    specimen_type_id: int,
    payload: UpdateSpecimenTypeRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> SpecimenTypeItem:
    ensure_admin(current_user)
    existing = (
        db.execute(
            text(
                """
                SELECT st.name, st.code_suffix, st.code_rule_confirmed,
                       count(s.id)::int AS sample_count
                FROM specimen_types st
                LEFT JOIN samples s ON s.specimen_type = st.name
                WHERE st.id = :specimen_type_id
                GROUP BY st.id
                """
            ),
            {"specimen_type_id": specimen_type_id},
        )
        .mappings()
        .first()
    )
    if existing is None:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="样本类型不存在",
        )

    values = payload.model_dump()
    values["code_suffix"] = normalize_code_rule(
        name=str(existing["name"]),
        code_rule_confirmed=payload.code_rule_confirmed,
        code_suffix=payload.code_suffix,
        allow_batch_code=payload.allow_batch_code,
    )
    rule_changed = (
        bool(existing["code_rule_confirmed"]) != payload.code_rule_confirmed
        or existing["code_suffix"] != values["code_suffix"]
    )
    if int(existing["sample_count"] or 0) > 0 and rule_changed:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="该类型已有样本，编码规则已锁定；可以调整启停和批量打码状态，但不能修改后缀",
        )

    try:
        row = (
            db.execute(
                text(
                    """
                    UPDATE specimen_types
                    SET is_active = :is_active,
                        allow_batch_code = :allow_batch_code,
                        uses_plate_wells = :uses_plate_wells,
                        code_suffix = :code_suffix,
                        code_rule_confirmed = :code_rule_confirmed,
                        sort_order = :sort_order,
                        note = :note,
                        updated_at = now()
                    WHERE id = :specimen_type_id
                    RETURNING id, name, is_active, allow_batch_code,
                              uses_plate_wells, code_suffix,
                              code_rule_confirmed, sort_order, note,
                              created_at, updated_at
                    """
                ),
                {"specimen_type_id": specimen_type_id, **values},
            )
            .mappings()
            .one()
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="该编码后缀已被其他样本类型使用",
        )
    sample_count = int(existing["sample_count"] or 0)
    return SpecimenTypeItem(
        **row,
        sample_count=sample_count,
        code_rule_locked=sample_count > 0,
    )
