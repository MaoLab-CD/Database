from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

SAMPLE_DIR_PATTERN = re.compile(r"^([0-9]{3,10}|[0-9]{6}-[0-9]{3}-[0-9]{10})$")
SEQUENCING_PROJECT_PATTERN = re.compile(r"^[A-Za-z0-9]+-Z[0-9]+-J[0-9]+$")
PROJECT_YEAR_PATTERN = re.compile(r"SC(?P<year>[0-9]{2})[0-9]{6}(?:-|$)", re.IGNORECASE)


@dataclass(frozen=True)
class SequencingScanResult:
    batch_id: int
    counters: dict[str, int]


def utc_from_timestamp(value: float) -> datetime:
    return datetime.fromtimestamp(value, tz=timezone.utc)


def is_sample_dir_name(project_code: str, name: str) -> bool:
    return bool(SAMPLE_DIR_PATTERN.fullmatch(name.strip()))


def find_sample_data_dir(project_dir: Path) -> Path | None:
    candidates = [
        project_dir / project_dir.name / "01.RawData",
        project_dir / "01.RawData",
    ]
    for candidate in candidates:
        if candidate.is_dir():
            return candidate
    # NAS 归档布局：项目目录下直接是样本目录，例如
    # X101SC25097427-Z01-J001/5010 和 X101SC26015140-Z01-J002/010702。
    # 只对符合测序项目命名的目录启用，避免把普通数字目录误识别为样本。
    if SEQUENCING_PROJECT_PATTERN.fullmatch(project_dir.name):
        try:
            if any(
                child.is_dir() and is_sample_dir_name(project_dir.name, child.name)
                for child in project_dir.iterdir()
            ):
                return project_dir
        except OSError:
            return None
    return None


# 保留旧函数名，兼容已有脚本或测试引用。
find_raw_data_dir = find_sample_data_dir


def first_matching_file(sample_dir: Path, patterns: list[str]) -> Path | None:
    for pattern in patterns:
        matches = sorted(path for path in sample_dir.glob(pattern) if path.is_file())
        if matches:
            return matches[0]
    return None


def parse_md5_file(path: Path | None) -> dict[str, str]:
    if not path or not path.exists():
        return {}
    values: dict[str, str] = {}
    try:
        for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
            parts = line.strip().split()
            if len(parts) >= 2:
                values[parts[-1]] = parts[0]
    except OSError:
        return {}
    return values


def date_prefixed_identifier_candidate(value: str, project_code: str | None) -> str | None:
    if not project_code or not value.isdigit():
        return None

    project_match = PROJECT_YEAR_PATTERN.search(project_code)
    if not project_match:
        return None

    project_year = project_match.group("year")
    if len(value) == 8 and value.startswith(project_year):
        date_text = value[:6]
        date_format = "%y%m%d"
        candidate = value[2:]
    elif len(value) == 10 and value.startswith(f"20{project_year}"):
        date_text = value[:8]
        date_format = "%Y%m%d"
        candidate = value[4:]
    else:
        return None

    try:
        datetime.strptime(date_text, date_format)
    except ValueError:
        return None
    return candidate


def identifier_candidates(value: str, project_code: str | None = None) -> list[str]:
    cleaned = value.strip()
    candidates: list[str] = []

    def add(candidate: str | None) -> None:
        if candidate and candidate not in candidates:
            candidates.append(candidate)

    add(cleaned)
    if cleaned.isdigit():
        # 只兼容已确认的 5/6 位前导零差异。四位历史编号属于独立编号，
        # 不能补成六位后误匹配其他中心的样本。
        if len(cleaned) == 6:
            add(cleaned.lstrip("0") or "0")
        elif len(cleaned) == 5:
            add(cleaned.zfill(6))
        add(date_prefixed_identifier_candidate(cleaned, project_code))
    return candidates


def resolve_sample(db: Session, identifier: str, project_code: str | None = None):
    cleaned_identifier = identifier.strip()
    candidates = identifier_candidates(cleaned_identifier, project_code)
    return db.execute(
        text(
            """
            SELECT id, sample_id, sample_code
            FROM samples
            WHERE is_deleted = false
              AND (
                sample_code = ANY(:identifiers)
                OR sample_id = ANY(:identifiers)
                OR barcode_no = ANY(:identifiers)
                OR lpad(COALESCE(sample_id, ''), 6, '0') = ANY(:identifiers)
              )
            ORDER BY
              CASE
                WHEN sample_code = :exact_identifier THEN 0
                WHEN sample_id = :exact_identifier THEN 1
                WHEN barcode_no = :exact_identifier THEN 2
                ELSE 3
              END,
              id
            LIMIT 1
            """
        ),
        {"identifiers": candidates, "exact_identifier": cleaned_identifier},
    ).mappings().first()


def sample_exists(db: Session, sample_id: str, project_code: str | None = None) -> bool:
    return resolve_sample(db, sample_id, project_code) is not None


def sample_identifiers(sample: Any, scanned_identifier: str) -> list[str]:
    values = [scanned_identifier.strip()]
    for key in ("sample_id", "sample_code"):
        if sample and sample[key]:
            values.append(str(sample[key]).strip())
    return sorted(set(values))


def summarize_sample_status(db: Session, sample: Any, scanned_identifier: str) -> None:
    identifiers = sample_identifiers(sample, scanned_identifier)
    rows = db.execute(
        text(
            """
            SELECT data_status
            FROM sequencing_data_records
            WHERE sample_id = ANY(:identifiers)
            """
        ),
        {"identifiers": identifiers},
    ).all()
    statuses = {row[0] for row in rows}
    if not statuses:
        summary = "none"
    elif "available" in statuses:
        summary = "available"
    elif "incomplete" in statuses:
        summary = "incomplete"
    elif "changed" in statuses:
        summary = "changed"
    elif "missing" in statuses:
        summary = "missing"
    elif "unmatched" in statuses:
        summary = "unmatched"
    else:
        summary = "none"

    db.execute(
        text(
            """
            UPDATE samples
            SET sequencing_status = :summary
            WHERE id = :sample_pk
            """
        ),
        {"summary": summary, "sample_pk": sample["id"]},
    )


def current_record(db: Session, project_code: str, sample_id: str, raw_data_path: str):
    return db.execute(
        text(
            """
            SELECT r1_file_size, r2_file_size, total_size_bytes, file_modified_at, md5_values, data_status
            FROM sequencing_data_records
            WHERE project_code = :project_code
              AND sample_id = :sample_id
              AND raw_data_path = :raw_data_path
            """
        ),
        {
            "project_code": project_code,
            "sample_id": sample_id,
            "raw_data_path": raw_data_path,
        },
    ).first()


def scan_sample_dir(
    db: Session,
    sample_dir: Path,
    project_code: str,
    root: Path,
    batch_id: int,
) -> str:
    sample_id = sample_dir.name.strip()
    r1 = first_matching_file(
        sample_dir,
        [f"{sample_id}_1.fq.gz", f"{sample_id}*_1.fq.gz", "*_1.fq.gz", "*R1*.fq.gz"],
    )
    r2 = first_matching_file(
        sample_dir,
        [f"{sample_id}_2.fq.gz", f"{sample_id}*_2.fq.gz", "*_2.fq.gz", "*R2*.fq.gz"],
    )
    md5 = first_matching_file(sample_dir, ["MD5.txt", "md5.txt", "*MD5*.txt", "*.md5"])

    r1_size = r1.stat().st_size if r1 else None
    r2_size = r2.stat().st_size if r2 else None
    child_paths = list(sample_dir.iterdir())
    file_paths = [path for path in child_paths if path.is_file()]
    total_size = sum(path.stat().st_size for path in file_paths)
    modified_at = utc_from_timestamp(max((path.stat().st_mtime for path in child_paths), default=sample_dir.stat().st_mtime))
    md5_values = parse_md5_file(md5)
    raw_data_path = str(sample_dir)

    sample = resolve_sample(db, sample_id, project_code)
    matched = sample is not None
    complete = bool(r1 and r2 and md5)
    existing = current_record(db, project_code, sample_id, raw_data_path)

    if not matched:
        status = "unmatched"
    elif not complete:
        status = "incomplete"
    else:
        status = "available"

    count_bucket = "new"
    if existing:
        old_r1_size, old_r2_size, old_total, _old_modified, old_md5, old_status = existing
        if (
            old_r1_size != r1_size
            or old_r2_size != r2_size
            or old_total != total_size
            or old_md5 != md5_values
        ):
            status = "changed" if complete and matched else status
            count_bucket = "changed"
        elif old_status == status:
            count_bucket = "existing"
        else:
            count_bucket = "changed"

    db.execute(
        text(
            """
            INSERT INTO sequencing_data_records (
                sample_id, sample_code, project_code, data_root_path, raw_data_path,
                r1_file_name, r2_file_name, md5_file_name,
                r1_file_size, r2_file_size, total_size_bytes,
                file_modified_at, md5_values, data_status,
                scan_batch_id, last_scanned_at
            )
            VALUES (
                :sample_id, :sample_code, :project_code, :data_root_path, :raw_data_path,
                :r1_file_name, :r2_file_name, :md5_file_name,
                :r1_file_size, :r2_file_size, :total_size_bytes,
                :file_modified_at, CAST(:md5_values AS jsonb), :data_status,
                :scan_batch_id, now()
            )
            ON CONFLICT (project_code, sample_id, raw_data_path) DO UPDATE SET
                sample_code = COALESCE(EXCLUDED.sample_code, sequencing_data_records.sample_code),
                r1_file_name = EXCLUDED.r1_file_name,
                r2_file_name = EXCLUDED.r2_file_name,
                md5_file_name = EXCLUDED.md5_file_name,
                r1_file_size = EXCLUDED.r1_file_size,
                r2_file_size = EXCLUDED.r2_file_size,
                total_size_bytes = EXCLUDED.total_size_bytes,
                file_modified_at = EXCLUDED.file_modified_at,
                md5_values = EXCLUDED.md5_values,
                data_status = EXCLUDED.data_status,
                scan_batch_id = EXCLUDED.scan_batch_id,
                last_scanned_at = now()
            """
        ),
        {
            "sample_id": sample_id,
            "sample_code": sample["sample_code"] if sample else None,
            "project_code": project_code,
            "data_root_path": str(root),
            "raw_data_path": raw_data_path,
            "r1_file_name": r1.name if r1 else None,
            "r2_file_name": r2.name if r2 else None,
            "md5_file_name": md5.name if md5 else None,
            "r1_file_size": r1_size,
            "r2_file_size": r2_size,
            "total_size_bytes": total_size,
            "file_modified_at": modified_at,
            "md5_values": json.dumps(md5_values, ensure_ascii=False),
            "data_status": status,
            "scan_batch_id": batch_id,
        },
    )

    if matched:
        summarize_sample_status(db, sample, sample_id)

    if status == "incomplete":
        return "incomplete"
    if status == "unmatched":
        return "unmatched"
    if status == "changed":
        return "changed"
    return count_bucket


def scan_sequencing_root(
    db: Session,
    root: Path,
    mode: str,
    projects: list[str] | None = None,
    created_by: int | None = None,
) -> SequencingScanResult:
    if mode not in {"full", "incremental"}:
        raise ValueError("扫描模式无效")
    if not root.exists():
        raise FileNotFoundError(f"扫描根目录不存在：{root}")
    if not root.is_dir():
        raise NotADirectoryError(f"扫描根路径不是目录：{root}")

    counters = {
        "total_projects": 0,
        "total_sample_dirs": 0,
        "new_count": 0,
        "existing_count": 0,
        "changed_count": 0,
        "missing_count": 0,
        "unmatched_count": 0,
        "incomplete_count": 0,
    }

    batch_id = db.execute(
        text(
            """
            INSERT INTO sequencing_scan_batches (scan_root_path, scan_mode, status, created_by)
            VALUES (:scan_root_path, :scan_mode, 'running', :created_by)
            RETURNING id
            """
        ),
        {
            "scan_root_path": str(root),
            "scan_mode": mode,
            "created_by": created_by,
        },
    ).scalar_one()
    db.commit()

    try:
        project_dirs = [path for path in sorted(root.iterdir()) if path.is_dir()]
        if projects:
            allowed = {project.strip() for project in projects if project.strip()}
            project_dirs = [path for path in project_dirs if path.name in allowed]

        for project_dir in project_dirs:
            sample_data_dir = find_sample_data_dir(project_dir)
            if sample_data_dir is None:
                continue
            counters["total_projects"] += 1
            project_code = project_dir.name
            sample_dirs = [
                path for path in sorted(sample_data_dir.iterdir())
                if path.is_dir() and is_sample_dir_name(project_code, path.name)
            ]
            for sample_dir in sample_dirs:
                counters["total_sample_dirs"] += 1
                bucket = scan_sample_dir(db, sample_dir, project_code, root, batch_id)
                key = f"{bucket}_count"
                if key in counters:
                    counters[key] += 1

        db.execute(
            text(
                """
                UPDATE sequencing_scan_batches
                SET status = 'completed',
                    finished_at = now(),
                    total_projects = :total_projects,
                    total_sample_dirs = :total_sample_dirs,
                    new_count = :new_count,
                    existing_count = :existing_count,
                    changed_count = :changed_count,
                    missing_count = :missing_count,
                    unmatched_count = :unmatched_count,
                    incomplete_count = :incomplete_count
                WHERE id = :batch_id
                """
            ),
            {**counters, "batch_id": batch_id},
        )
        db.commit()
        return SequencingScanResult(batch_id=batch_id, counters=counters)
    except Exception as exc:
        db.rollback()
        db.execute(
            text(
                """
                UPDATE sequencing_scan_batches
                SET status = 'failed',
                    finished_at = now(),
                    error_message = :error_message
                WHERE id = :batch_id
                """
            ),
            {"error_message": str(exc), "batch_id": batch_id},
        )
        db.commit()
        raise
