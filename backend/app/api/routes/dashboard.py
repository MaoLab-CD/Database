from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.db.session import get_db

router = APIRouter()


class CountItem(BaseModel):
    name: str
    count: int


class LatestImportBatch(BaseModel):
    file_name: str | None = None
    total_rows: int = 0
    success_rows: int = 0
    failed_rows: int = 0
    uploaded_at: datetime | None = None
    status: str | None = None


class LatestScanBatch(BaseModel):
    scan_root_path: str | None = None
    total_projects: int = 0
    total_sample_dirs: int = 0
    new_count: int = 0
    unmatched_count: int = 0
    incomplete_count: int = 0
    finished_at: datetime | None = None
    status: str | None = None


class DashboardSummary(BaseModel):
    total_samples: int
    in_storage_count: int
    checked_out_count: int
    return_pending_count: int
    unavailable_count: int
    sequencing_available_count: int
    sequencing_unmatched_count: int
    sample_status_counts: list[CountItem]
    sequencing_status_counts: list[CountItem]
    ethnicity_counts: list[CountItem]
    latest_import_batch: LatestImportBatch | None = None
    latest_scan_batch: LatestScanBatch | None = None


def count_rows(rows: list[dict[str, Any]], key: str) -> int:
    for row in rows:
        if row["name"] == key:
            return int(row["count"])
    return 0


@router.get("/summary", response_model=DashboardSummary)
def summary(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> DashboardSummary:
    sample_status_rows = [
        {"name": row["name"], "count": int(row["count"])}
        for row in db.execute(
            text(
                """
                SELECT sample_status AS name, count(*) AS count
                FROM samples
                WHERE is_deleted = false
                GROUP BY sample_status
                ORDER BY count DESC, sample_status
                """
            )
        )
        .mappings()
        .all()
    ]

    sequencing_status_rows = [
        {"name": row["name"], "count": int(row["count"])}
        for row in db.execute(
            text(
                """
                SELECT sequencing_status AS name, count(*) AS count
                FROM samples
                WHERE is_deleted = false
                GROUP BY sequencing_status
                ORDER BY count DESC, sequencing_status
                """
            )
        )
        .mappings()
        .all()
    ]

    ethnicity_rows = [
        {"name": row["name"], "count": int(row["count"])}
        for row in db.execute(
            text(
                """
                SELECT COALESCE(NULLIF(ethnicity, ''), '未填写') AS name,
                       count(*) AS count
                FROM samples
                WHERE is_deleted = false
                GROUP BY COALESCE(NULLIF(ethnicity, ''), '未填写')
                ORDER BY count DESC, name
                LIMIT 8
                """
            )
        )
        .mappings()
        .all()
    ]

    latest_import = (
        db.execute(
            text(
                """
                SELECT file_name,
                       total_rows,
                       success_rows,
                       failed_rows,
                       uploaded_at,
                       status
                FROM sample_import_batches
                ORDER BY id DESC
                LIMIT 1
                """
            )
        )
        .mappings()
        .first()
    )

    latest_scan = (
        db.execute(
            text(
                """
                SELECT scan_root_path,
                       total_projects,
                       total_sample_dirs,
                       new_count,
                       unmatched_count,
                       incomplete_count,
                       finished_at,
                       status
                FROM sequencing_scan_batches
                ORDER BY id DESC
                LIMIT 1
                """
            )
        )
        .mappings()
        .first()
    )

    total_samples = sum(row["count"] for row in sample_status_rows)
    unavailable_count = sum(
        count_rows(sample_status_rows, key)
        for key in ("checked_out", "return_pending", "consumed", "lost", "discarded")
    )

    return DashboardSummary(
        total_samples=total_samples,
        in_storage_count=count_rows(sample_status_rows, "in_storage"),
        checked_out_count=count_rows(sample_status_rows, "checked_out"),
        return_pending_count=count_rows(sample_status_rows, "return_pending"),
        unavailable_count=unavailable_count,
        sequencing_available_count=count_rows(sequencing_status_rows, "available"),
        sequencing_unmatched_count=count_rows(sequencing_status_rows, "unmatched"),
        sample_status_counts=[CountItem(**row) for row in sample_status_rows],
        sequencing_status_counts=[CountItem(**row) for row in sequencing_status_rows],
        ethnicity_counts=[CountItem(**row) for row in ethnicity_rows],
        latest_import_batch=LatestImportBatch(**latest_import) if latest_import else None,
        latest_scan_batch=LatestScanBatch(**latest_scan) if latest_scan else None,
    )
