'''
Author: 袁瑞 && 2502099390@qq.com
Date: 2026-06-15 16:01:37
LastEditors: 袁瑞 && 2502099390@qq.com
LastEditTime: 2026-06-15 17:28:24
FilePath: \sample_admin\backend\app\api\routes\returns.py
Description: 
'''
from __future__ import annotations

import json
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.db.session import get_db
from app.services.login_rate_limit import client_ip_from_request
from app.services.storage_freezers import build_freezer_label

router = APIRouter()

FinalReturnStatus = Literal["in_storage", "consumed", "lost", "discarded"]


class PendingReturnItem(BaseModel):
    id: int
    sample_pk: int
    sample_id: str
    sample_code: str | None = None
    checkout_record_id: int
    returned_by: int
    returned_by_name: str | None = None
    return_requested_at: datetime
    purpose: str | None = None
    used_amount: str | None = None
    unit: str | None = None
    used_volume_ul: float | None = None
    return_location: str | None = None
    note: str | None = None
    sample_status: str
    barcode_no: str | None = None
    patient_no: str | None = None
    ethnicity: str | None = None
    specimen_type: str | None = None
    department: str | None = None
    checkout_time: datetime | None = None
    checkout_user_name: str | None = None


class ConfirmReturnRequest(BaseModel):
    final_status: FinalReturnStatus
    note: str | None = None


class ConfirmReturnResult(BaseModel):
    return_record_id: int
    sample_id: str
    final_status: str
    message: str


class BatchConfirmReturnRequest(BaseModel):
    return_record_ids: list[int] = Field(min_length=1, max_length=100)
    final_status: FinalReturnStatus
    note: str | None = None


class BatchConfirmReturnResult(BaseModel):
    confirmed_count: int
    final_status: str
    items: list[ConfirmReturnResult]
    message: str


def ensure_admin(current_user: CurrentUser) -> None:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有管理员可以复核归还申请",
        )


@router.get("/pending", response_model=list[PendingReturnItem])
def list_pending_returns(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[PendingReturnItem]:
    ensure_admin(current_user)

    rows = (
        db.execute(
            text(
                """
                SELECT r.id,
                       r.sample_pk,
                       r.sample_id,
                       s.sample_code,
                       r.checkout_record_id,
                       r.returned_by,
                       ru.display_name AS returned_by_name,
                       r.return_requested_at,
                       r.purpose,
                       r.used_amount,
                       r.unit,
                       r.used_volume_ul,
                       r.return_location,
                       r.note,
                       s.sample_status,
                       s.barcode_no,
                       s.patient_no,
                       s.ethnicity,
                       s.specimen_type,
                       s.department,
                       c.checkout_time,
                       cu.display_name AS checkout_user_name
                FROM sample_return_records r
                JOIN samples s ON s.id = r.sample_pk
                JOIN sample_checkout_records c ON c.id = r.checkout_record_id
                LEFT JOIN users ru ON ru.id = r.returned_by
                LEFT JOIN users cu ON cu.id = c.checkout_user_id
                WHERE r.status = 'pending'
                ORDER BY r.return_requested_at ASC, r.id ASC
                """
            )
        )
        .mappings()
        .all()
    )

    return [PendingReturnItem(**row) for row in rows]


def build_plate_storage_location(plate_well: dict[str, object]) -> str:
    freezer_label = None
    if plate_well.get("freezer_code") and plate_well.get("temperature_c") is not None:
        freezer_label = build_freezer_label(
            str(plate_well["freezer_code"]),
            plate_well["temperature_c"],
        )
    parts = [
        freezer_label,
        f"{plate_well['layer_no']}层" if plate_well.get("layer_no") else None,
        f"{plate_well['container_no']}号盒" if plate_well.get("container_no") else None,
        str(plate_well["plate_code"]),
        str(plate_well["well_code"]),
    ]
    return " / ".join(part for part in parts if part)


def resolve_final_storage_location(
    final_status: FinalReturnStatus,
    specimen_type: str | None,
    return_location: str | None,
    current_location: str | None,
    plate_well: dict[str, object] | None,
) -> str | None:
    if final_status != "in_storage":
        return None
    if specimen_type == "DNA" and plate_well is not None:
        return build_plate_storage_location(plate_well)
    return return_location or current_location


def confirm_return_record(
    return_record_id: int,
    payload: ConfirmReturnRequest,
    request: Request,
    db: Session,
    current_user: CurrentUser,
) -> ConfirmReturnResult:
    return_record = (
        db.execute(
            text(
                """
                SELECT id,
                       sample_pk,
                       sample_id,
                       checkout_record_id,
                       status,
                       return_location,
                       note
                FROM sample_return_records
                WHERE id = :return_record_id
                FOR UPDATE
                """
            ),
            {"return_record_id": return_record_id},
        )
        .mappings()
        .first()
    )

    if return_record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="归还申请不存在")

    if return_record["status"] != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="该归还申请已经处理",
        )

    sample = (
        db.execute(
            text(
                """
                SELECT id,
                       sample_id,
                       sample_code,
                       specimen_type,
                       sample_status,
                       storage_location
                FROM samples
                WHERE id = :sample_pk AND is_deleted = false
                FOR UPDATE
                """
            ),
            {"sample_pk": return_record["sample_pk"]},
        )
        .mappings()
        .first()
    )

    if sample is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="样本不存在")

    if sample["sample_status"] != "return_pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"当前样本状态为 {sample['sample_status']}，不可复核归还",
        )

    plate_well = (
        db.execute(
            text(
                """
                SELECT w.id AS well_id,
                       w.plate_id,
                       w.well_code,
                       p.plate_code,
                       p.layer_no,
                       p.container_no,
                       f.freezer_code,
                       f.temperature_c
                FROM sample_plate_wells w
                JOIN sample_plates p ON p.id = w.plate_id
                LEFT JOIN storage_freezers f ON f.id = p.freezer_id
                WHERE w.sample_pk = :sample_pk
                  AND w.removed_at IS NULL
                FOR UPDATE OF w
                """
            ),
            {"sample_pk": sample["id"]},
        )
        .mappings()
        .first()
    )

    released_plate_well: dict[str, str] | None = None
    final_location = resolve_final_storage_location(
        payload.final_status,
        sample["specimen_type"],
        return_record["return_location"],
        sample["storage_location"],
        dict(plate_well) if plate_well is not None else None,
    )
    if payload.final_status != "in_storage":
        if plate_well is not None:
            db.execute(
                text(
                    """
                    UPDATE sample_plate_wells
                    SET removed_at = now(),
                        removed_by = :removed_by,
                        note = COALESCE(note, :note),
                        updated_at = now()
                    WHERE id = :well_id
                    """
                ),
                {
                    "well_id": plate_well["well_id"],
                    "removed_by": current_user.id,
                    "note": f"归还复核为 {payload.final_status}，释放活动孔位",
                },
            )
            db.execute(
                text(
                    """
                    UPDATE sample_plates
                    SET updated_by = :updated_by,
                        updated_at = now()
                    WHERE id = :plate_id
                    """
                ),
                {
                    "plate_id": plate_well["plate_id"],
                    "updated_by": current_user.id,
                },
            )
            released_plate_well = {
                "plate_code": str(plate_well["plate_code"]),
                "well_code": str(plate_well["well_code"]),
            }

    db.execute(
        text(
            """
            UPDATE sample_return_records
            SET status = 'confirmed',
                final_status = :final_status,
                confirmed_by = :confirmed_by,
                confirmed_at = now(),
                note = COALESCE(:note, note),
                updated_at = now()
            WHERE id = :return_record_id
            """
        ),
        {
            "return_record_id": return_record_id,
            "final_status": payload.final_status,
            "confirmed_by": current_user.id,
            "note": payload.note,
        },
    )

    db.execute(
        text(
            """
            UPDATE sample_checkout_records
            SET status = 'returned',
                updated_at = now()
            WHERE id = :checkout_record_id
            """
        ),
        {"checkout_record_id": return_record["checkout_record_id"]},
    )

    db.execute(
        text(
            """
            UPDATE samples
            SET sample_status = :final_status,
                current_holder_id = NULL,
                storage_location = :final_location,
                updated_by = :updated_by,
                updated_at = now()
            WHERE id = :sample_pk
            """
        ),
        {
            "sample_pk": return_record["sample_pk"],
            "final_status": payload.final_status,
            "final_location": final_location,
            "updated_by": current_user.id,
        },
    )

    db.execute(
        text(
            """
            INSERT INTO sample_movement_logs (
                sample_pk,
                sample_id,
                sample_code,
                action_type,
                before_status,
                after_status,
                before_location,
                after_location,
                operator_id,
                operator_role,
                related_record_id,
                detail,
                note,
                ip_address,
                device_info
            )
            VALUES (
                :sample_pk,
                :sample_id,
                :sample_code,
                'return_confirm',
                :before_status,
                :after_status,
                :before_location,
                :after_location,
                :operator_id,
                :operator_role,
                :related_record_id,
                CAST(:detail AS jsonb),
                :note,
                :ip_address,
                :device_info
            )
            """
        ),
        {
            "sample_pk": return_record["sample_pk"],
            "sample_id": return_record["sample_id"],
            "sample_code": sample["sample_code"],
            "before_status": sample["sample_status"],
            "after_status": payload.final_status,
            "before_location": sample["storage_location"],
            "after_location": final_location,
            "operator_id": current_user.id,
            "operator_role": current_user.role,
            "related_record_id": return_record_id,
            "detail": json.dumps(
                {
                    "source": "return_review",
                    "released_plate_well": released_plate_well,
                },
                ensure_ascii=False,
            ),
            "note": payload.note,
            "ip_address": client_ip_from_request(request),
            "device_info": request.headers.get("user-agent"),
        },
    )

    return ConfirmReturnResult(
        return_record_id=return_record_id,
        sample_id=return_record["sample_id"],
        final_status=payload.final_status,
        message="归还复核已完成",
    )


@router.post("/batch/confirm", response_model=BatchConfirmReturnResult)
def confirm_returns_batch(
    payload: BatchConfirmReturnRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> BatchConfirmReturnResult:
    ensure_admin(current_user)
    return_record_ids = sorted(set(payload.return_record_ids))
    if len(return_record_ids) != len(payload.return_record_ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="批量复核记录不能重复",
        )

    confirm_payload = ConfirmReturnRequest(
        final_status=payload.final_status,
        note=payload.note,
    )
    try:
        items = [
            confirm_return_record(
                return_record_id,
                confirm_payload,
                request,
                db,
                current_user,
            )
            for return_record_id in return_record_ids
        ]
        db.commit()
    except Exception:
        db.rollback()
        raise

    return BatchConfirmReturnResult(
        confirmed_count=len(items),
        final_status=payload.final_status,
        items=items,
        message=f"已完成 {len(items)} 条归还复核",
    )


@router.post("/{return_record_id}/confirm", response_model=ConfirmReturnResult)
def confirm_return(
    return_record_id: int,
    payload: ConfirmReturnRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ConfirmReturnResult:
    ensure_admin(current_user)
    try:
        result = confirm_return_record(
            return_record_id,
            payload,
            request,
            db,
            current_user,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return result
