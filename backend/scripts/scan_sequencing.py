'''
Author: 袁瑞 && 2502099390@qq.com
Date: 2026-06-12 13:40:49
LastEditors: 袁瑞 && 2502099390@qq.com
LastEditTime: 2026-06-12 15:01:02
FilePath: \sample_admin\backend\scripts\scan_sequencing.py
Description: 
'''
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

from common import database_url, sequencing_root


SAMPLE_DIR_PATTERN = re.compile(r"^([0-9]{3,10}|[0-9]{6}-[0-9]{3}-[0-9]{10})$")
SEQUENCING_PROJECT_PATTERN = re.compile(r"^[A-Za-z0-9]+-Z[0-9]+-J[0-9]+$")
PROJECT_YEAR_PATTERN = re.compile(r"SC(?P<year>[0-9]{2})[0-9]{6}(?:-|$)", re.IGNORECASE)


def is_sample_dir_name(project_code: str, name: str) -> bool:
    return bool(SAMPLE_DIR_PATTERN.fullmatch(name.strip()))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scan sequencing raw data directories.")
    parser.add_argument("--root", default=sequencing_root(), help="Sequencing root directory")
    parser.add_argument("--mode", choices=["full", "incremental"], default="incremental")
    parser.add_argument(
        "--project",
        action="append",
        help="Limit to one or more project directory names. Can be passed multiple times.",
    )
    return parser.parse_args()


def utc_from_timestamp(value: float) -> datetime:
    return datetime.fromtimestamp(value, tz=timezone.utc)


def find_raw_data_dir(project_dir: Path) -> Path | None:
    candidates = [
        project_dir / project_dir.name / "01.RawData",
        project_dir / "01.RawData",
    ]
    for candidate in candidates:
        if candidate.is_dir():
            return candidate
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
        if len(cleaned) == 6:
            add(cleaned.lstrip("0") or "0")
        elif len(cleaned) == 5:
            add(cleaned.zfill(6))
        add(date_prefixed_identifier_candidate(cleaned, project_code))
    return candidates


def resolve_sample(
    conn: psycopg.Connection,
    identifier: str,
    project_code: str | None = None,
):
    cleaned_identifier = identifier.strip()
    candidates = identifier_candidates(cleaned_identifier, project_code)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, sample_id, sample_code
            FROM samples
            WHERE is_deleted = false
              AND (
                sample_code = ANY(%s)
                OR sample_id = ANY(%s)
                OR barcode_no = ANY(%s)
                OR lpad(COALESCE(sample_id, ''), 6, '0') = ANY(%s)
              )
            ORDER BY
              CASE
                WHEN sample_code = %s THEN 0
                WHEN sample_id = %s THEN 1
                WHEN barcode_no = %s THEN 2
                ELSE 3
              END,
              id
            LIMIT 1
            """,
            (
                candidates,
                candidates,
                candidates,
                candidates,
                cleaned_identifier,
                cleaned_identifier,
                cleaned_identifier,
            ),
        )
        return cur.fetchone()


def sample_exists(
    conn: psycopg.Connection,
    sample_id: str,
    project_code: str | None = None,
) -> bool:
    return resolve_sample(conn, sample_id, project_code) is not None


def current_record(conn: psycopg.Connection, project_code: str, sample_id: str, raw_data_path: str):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT r1_file_size, r2_file_size, total_size_bytes, file_modified_at, md5_values, data_status
            FROM sequencing_data_records
            WHERE project_code = %s AND sample_id = %s AND raw_data_path = %s
            """,
            (project_code, sample_id, raw_data_path),
        )
        return cur.fetchone()


def sample_identifiers(sample: tuple, scanned_identifier: str) -> list[str]:
    values = [scanned_identifier.strip()]
    for value in (sample[1], sample[2]):
        if value:
            values.append(str(value).strip())
    return sorted(set(values))


def summarize_sample_status(conn: psycopg.Connection, sample: tuple, scanned_identifier: str) -> None:
    identifiers = sample_identifiers(sample, scanned_identifier)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT data_status
            FROM sequencing_data_records
            WHERE sample_id = ANY(%s)
            """,
            (identifiers,),
        )
        statuses = {row[0] for row in cur.fetchall()}
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

        cur.execute(
            """
            UPDATE samples
            SET sequencing_status = %s
            WHERE id = %s
            """,
            (summary, sample[0]),
        )


def scan_sample_dir(
    conn: psycopg.Connection,
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

    sample = resolve_sample(conn, sample_id, project_code)
    matched = sample is not None
    complete = bool(r1 and r2 and md5)
    existing = current_record(conn, project_code, sample_id, raw_data_path)

    if not matched:
        status = "unmatched"
    elif not complete:
        status = "incomplete"
    else:
        status = "available"

    if existing:
        old_r1_size, old_r2_size, old_total, old_modified, old_md5, old_status = existing
        if (
            old_r1_size != r1_size
            or old_r2_size != r2_size
            or old_total != total_size
            or old_md5 != md5_values
        ):
            status = "changed" if complete and matched else status
        elif old_status == status:
            count_bucket = "existing"
        else:
            count_bucket = "changed"
    else:
        count_bucket = "new"

    with conn.cursor() as cur:
        sample_code_value = sample[2] if sample else None
        cur.execute(
            """
            INSERT INTO sequencing_data_records (
                sample_id, sample_code, project_code, data_root_path, raw_data_path,
                r1_file_name, r2_file_name, md5_file_name,
                r1_file_size, r2_file_size, total_size_bytes,
                file_modified_at, md5_values, data_status,
                scan_batch_id, last_scanned_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
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
            """,
            (
                sample_id,
                sample_code_value,
                project_code,
                str(root),
                raw_data_path,
                r1.name if r1 else None,
                r2.name if r2 else None,
                md5.name if md5 else None,
                r1_size,
                r2_size,
                total_size,
                modified_at,
                Jsonb(md5_values),
                status,
                batch_id,
            ),
        )

    if matched:
        summarize_sample_status(conn, sample, sample_id)

    if status == "incomplete":
        return "incomplete"
    if status == "unmatched":
        return "unmatched"
    if status == "changed":
        return "changed"
    return count_bucket


def scan(root: Path, mode: str, projects: list[str] | None) -> None:
    if not root.exists():
        raise FileNotFoundError(f"Root path does not exist: {root}")

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

    with psycopg.connect(database_url()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO sequencing_scan_batches (scan_root_path, scan_mode, status)
                VALUES (%s, %s, 'running')
                RETURNING id
                """,
                (str(root), mode),
            )
            batch_id = cur.fetchone()[0]
        conn.commit()

        try:
            project_dirs = [path for path in sorted(root.iterdir()) if path.is_dir()]
            if projects:
                allowed = set(projects)
                project_dirs = [path for path in project_dirs if path.name in allowed]

            for project_dir in project_dirs:
                raw_dir = find_raw_data_dir(project_dir)
                if raw_dir is None:
                    continue
                counters["total_projects"] += 1
                project_code = project_dir.name
                sample_dirs = [
                    path for path in sorted(raw_dir.iterdir())
                    if path.is_dir() and is_sample_dir_name(project_code, path.name)
                ]
                for sample_dir in sample_dirs:
                    counters["total_sample_dirs"] += 1
                    bucket = scan_sample_dir(conn, sample_dir, project_code, root, batch_id)
                    key = f"{bucket}_count"
                    if key in counters:
                        counters[key] += 1

            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE sequencing_scan_batches
                    SET status = 'completed',
                        finished_at = now(),
                        total_projects = %(total_projects)s,
                        total_sample_dirs = %(total_sample_dirs)s,
                        new_count = %(new_count)s,
                        existing_count = %(existing_count)s,
                        changed_count = %(changed_count)s,
                        missing_count = %(missing_count)s,
                        unmatched_count = %(unmatched_count)s,
                        incomplete_count = %(incomplete_count)s
                    WHERE id = %(batch_id)s
                    """,
                    {**counters, "batch_id": batch_id},
                )
            conn.commit()
        except Exception as exc:
            conn.rollback()
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE sequencing_scan_batches
                    SET status = 'failed',
                        finished_at = now(),
                        error_message = %s
                    WHERE id = %s
                    """,
                    (str(exc), batch_id),
                )
            conn.commit()
            raise

    print(json.dumps(counters, ensure_ascii=False, indent=2))


def main() -> None:
    args = parse_args()
    scan(Path(args.root).resolve(), args.mode, args.project)


if __name__ == "__main__":
    main()
