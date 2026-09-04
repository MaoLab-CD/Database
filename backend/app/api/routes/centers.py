from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.db.session import get_db

router = APIRouter()


class DistrictItem(BaseModel):
    district_code: str
    district_name: str
    city_name: str | None = None
    province: str | None = None
    is_active: bool


class CreateDistrictRequest(BaseModel):
    district_code: str = Field(pattern=r"^\d{6}$")
    district_name: str = Field(min_length=1, max_length=100)
    city_name: str | None = Field(default=None, max_length=100)
    province: str | None = Field(default="四川", max_length=100)
    is_active: bool = True


class UpdateDistrictRequest(BaseModel):
    district_name: str = Field(min_length=1, max_length=100)
    city_name: str | None = Field(default=None, max_length=100)
    province: str | None = Field(default=None, max_length=100)
    is_active: bool


class CenterItem(BaseModel):
    id: int
    center_code: str
    center_name: str
    province: str | None = None
    district_code: str
    district_name: str | None = None
    city_name: str | None = None
    region: str | None = None
    hospital_seq: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class CenterListResponse(BaseModel):
    items: list[CenterItem]
    total: int
    page: int
    page_size: int


class HospitalSeqOptions(BaseModel):
    district_code: str
    used: list[str]
    next_seq: str | None = None


class SampleSerialSuggestion(BaseModel):
    center_code: str
    code_date: str
    used_count: int
    max_serial: int
    next_serial: int | None = None


class CreateCenterRequest(BaseModel):
    district_code: str = Field(pattern=r"^\d{6}$")
    hospital_seq: str = Field(pattern=r"^\d{3}$")
    center_name: str = Field(min_length=1, max_length=128)
    province: str | None = Field(default=None, max_length=64)
    region: str | None = Field(default=None, max_length=64)
    is_active: bool = True


class UpdateCenterRequest(BaseModel):
    center_name: str = Field(min_length=1, max_length=128)
    province: str | None = Field(default=None, max_length=64)
    region: str | None = Field(default=None, max_length=64)
    is_active: bool


def ensure_center_manage(current_user: CurrentUser) -> None:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="没有中心管理权限",
        )


def ensure_center_reference_access(current_user: CurrentUser) -> None:
    if current_user.role == "admin" or current_user.permissions.get("batch_code_generate"):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="没有中心编码查询权限",
    )


def ensure_district_exists(db: Session, district_code: str) -> None:
    exists = db.execute(
        text(
            """
            SELECT 1
            FROM districts
            WHERE district_code = :district_code
              AND right(district_code, 2) <> '00'
            """
        ),
        {"district_code": district_code},
    ).scalar_one_or_none()
    if exists is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="区县不存在")


@router.get("/districts", response_model=list[DistrictItem])
def list_districts(
    active_only: bool = Query(default=True),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[DistrictItem]:
    ensure_center_reference_access(current_user)
    if current_user.role != "admin":
        active_only = True
    clauses = ["right(district_code, 2) <> '00'"]
    if active_only:
        clauses.append("is_active = true")
    where_sql = "WHERE " + " AND ".join(clauses)
    rows = (
        db.execute(
            text(
                f"""
                SELECT district_code,
                       district_name,
                       city_name,
                       province,
                       is_active
                FROM districts
                {where_sql}
                ORDER BY district_code
                """
            )
        )
        .mappings()
        .all()
    )
    return [DistrictItem(**row) for row in rows]


@router.post("/districts", response_model=DistrictItem)
def create_district(
    payload: CreateDistrictRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> DistrictItem:
    ensure_center_manage(current_user)
    if payload.district_code.endswith("00"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请填写区县级编码，不使用省级或市级编码",
        )
    try:
        row = (
            db.execute(
                text(
                    """
                    INSERT INTO districts (
                        district_code,
                        district_name,
                        city_name,
                        province,
                        is_active
                    )
                    VALUES (
                        :district_code,
                        :district_name,
                        :city_name,
                        :province,
                        :is_active
                    )
                    RETURNING district_code,
                              district_name,
                              city_name,
                              province,
                              is_active
                    """
                ),
                {
                    "district_code": payload.district_code,
                    "district_name": payload.district_name.strip(),
                    "city_name": (payload.city_name or "").strip() or None,
                    "province": (payload.province or "").strip() or None,
                    "is_active": payload.is_active,
                },
            )
            .mappings()
            .one()
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="区县编码已存在")
    return DistrictItem(**row)


@router.get("/districts/{district_code}/hospital-seqs", response_model=HospitalSeqOptions)
def get_hospital_seq_options(
    district_code: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> HospitalSeqOptions:
    ensure_center_manage(current_user)
    ensure_district_exists(db, district_code)
    rows = (
        db.execute(
            text(
                """
                SELECT hospital_seq
                FROM centers
                WHERE district_code = :district_code
                ORDER BY hospital_seq
                """
            ),
            {"district_code": district_code},
        )
        .scalars()
        .all()
    )
    used = [str(row) for row in rows]
    used_set = set(used)
    next_seq = None
    for value in range(1, 1000):
        candidate = f"{value:03d}"
        if candidate not in used_set:
            next_seq = candidate
            break
    return HospitalSeqOptions(district_code=district_code, used=used, next_seq=next_seq)


@router.get("/{center_code}/sample-serial-suggestion", response_model=SampleSerialSuggestion)
def get_sample_serial_suggestion(
    center_code: str,
    code_date: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> SampleSerialSuggestion:
    ensure_center_reference_access(current_user)
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="中心不存在或已停用")

    try:
        date_prefix = datetime.strptime(code_date, "%Y-%m-%d").strftime("%y%m%d")
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="日期格式不正确")

    row = (
        db.execute(
            text(
                """
                SELECT count(*) AS used_count,
                       COALESCE(max(substring(sample_seq FROM 7 FOR 4)::int), 0) AS max_serial
                FROM samples
                WHERE is_deleted = false
                  AND center_code = :center_code
                  AND sample_seq ~ :sample_seq_pattern
                """
            ),
            {
                "center_code": center_code,
                "sample_seq_pattern": f"^{date_prefix}[0-9]{{4}}[A-Za-z]?$",
            },
        )
        .mappings()
        .one()
    )
    max_serial = int(row["max_serial"] or 0)
    next_serial = max_serial + 1 if max_serial < 9999 else None
    return SampleSerialSuggestion(
        center_code=center_code,
        code_date=code_date,
        used_count=int(row["used_count"] or 0),
        max_serial=max_serial,
        next_serial=next_serial,
    )


@router.put("/districts/{district_code}", response_model=DistrictItem)
def update_district(
    district_code: str,
    payload: UpdateDistrictRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> DistrictItem:
    ensure_center_manage(current_user)
    row = (
        db.execute(
            text(
                """
                UPDATE districts
                SET district_name = :district_name,
                    city_name = :city_name,
                    province = :province,
                    is_active = :is_active,
                    updated_at = now()
                WHERE district_code = :district_code
                RETURNING district_code,
                          district_name,
                          city_name,
                          province,
                          is_active
                """
            ),
            {
                "district_code": district_code,
                "district_name": payload.district_name.strip(),
                "city_name": (payload.city_name or "").strip() or None,
                "province": (payload.province or "").strip() or None,
                "is_active": payload.is_active,
            },
        )
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="区县不存在")
    db.commit()
    return DistrictItem(**row)


@router.get("", response_model=CenterListResponse)
def list_centers(
    keyword: str | None = Query(default=None),
    active_status: Literal["active", "inactive"] | None = Query(default=None),
    district_code: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> CenterListResponse:
    ensure_center_reference_access(current_user)
    if current_user.role != "admin":
        active_status = "active"
    clauses = ["1 = 1"]
    params: dict[str, object] = {}

    if keyword:
        clauses.append("(c.center_code ILIKE :keyword OR c.center_name ILIKE :keyword)")
        params["keyword"] = f"%{keyword.strip()}%"

    if active_status:
        clauses.append("c.is_active = :is_active")
        params["is_active"] = active_status == "active"

    if district_code:
        clauses.append("c.district_code = :district_code")
        params["district_code"] = district_code

    where_sql = " AND ".join(clauses)
    offset = (page - 1) * page_size

    total = db.execute(
        text(
            f"""
            SELECT count(*)
            FROM centers c
            WHERE {where_sql}
            """
        ),
        params,
    ).scalar_one()

    rows = (
        db.execute(
            text(
                f"""
                SELECT c.id,
                       c.center_code,
                       c.center_name,
                       c.province,
                       c.district_code,
                       d.district_name,
                       d.city_name,
                       c.region,
                       c.hospital_seq,
                       c.is_active,
                       c.created_at,
                       c.updated_at
                FROM centers c
                LEFT JOIN districts d ON d.district_code = c.district_code
                WHERE {where_sql}
                ORDER BY c.district_code, c.hospital_seq, c.id
                LIMIT :limit OFFSET :offset
                """
            ),
            {**params, "limit": page_size, "offset": offset},
        )
        .mappings()
        .all()
    )

    return CenterListResponse(
        items=[CenterItem(**row) for row in rows],
        total=int(total),
        page=page,
        page_size=page_size,
    )


@router.post("", response_model=CenterItem)
def create_center(
    payload: CreateCenterRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> CenterItem:
    ensure_center_manage(current_user)
    ensure_district_exists(db, payload.district_code)

    try:
        row = (
            db.execute(
                text(
                    """
                    INSERT INTO centers (
                        center_code,
                        center_name,
                        province,
                        district_code,
                        region,
                        hospital_seq,
                        is_active
                    )
                    VALUES (
                        :center_code,
                        :center_name,
                        :province,
                        :district_code,
                        :region,
                        :hospital_seq,
                        :is_active
                    )
                    RETURNING id,
                              center_code,
                              center_name,
                              province,
                              district_code,
                              region,
                              hospital_seq,
                              is_active,
                              created_at,
                              updated_at
                    """
                ),
                {
                    "center_code": f"{payload.district_code}-{payload.hospital_seq}",
                    "center_name": payload.center_name.strip(),
                    "province": (payload.province or "").strip() or None,
                    "district_code": payload.district_code,
                    "region": (payload.region or "").strip() or None,
                    "hospital_seq": payload.hospital_seq,
                    "is_active": payload.is_active,
                },
            )
            .mappings()
            .one()
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="中心编码已存在")

    enriched = dict(row)
    district = db.execute(
        text("SELECT district_name, city_name FROM districts WHERE district_code = :district_code"),
        {"district_code": row["district_code"]},
    ).mappings().first()
    if district:
        enriched.update(dict(district))
    return CenterItem(**enriched)


@router.put("/{center_id}", response_model=CenterItem)
def update_center(
    center_id: int,
    payload: UpdateCenterRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> CenterItem:
    ensure_center_manage(current_user)
    row = (
        db.execute(
            text(
                """
                UPDATE centers
                SET center_name = :center_name,
                    province = :province,
                    region = :region,
                    is_active = :is_active,
                    updated_at = now()
                WHERE id = :center_id
                RETURNING id,
                          center_code,
                          center_name,
                          province,
                          district_code,
                          region,
                          hospital_seq,
                          is_active,
                          created_at,
                          updated_at
                """
            ),
            {
                "center_id": center_id,
                "center_name": payload.center_name.strip(),
                "province": (payload.province or "").strip() or None,
                "region": (payload.region or "").strip() or None,
                "is_active": payload.is_active,
            },
        )
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="中心不存在")
    db.commit()

    enriched = dict(row)
    district = db.execute(
        text("SELECT district_name, city_name FROM districts WHERE district_code = :district_code"),
        {"district_code": row["district_code"]},
    ).mappings().first()
    if district:
        enriched.update(dict(district))
    return CenterItem(**enriched)
