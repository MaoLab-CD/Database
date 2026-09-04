'''
Author: 袁瑞 && 2502099390@qq.com
Date: 2026-06-12 14:41:04
LastEditors: 袁瑞 && 2502099390@qq.com
LastEditTime: 2026-06-12 15:01:59
FilePath: \sample_admin\backend\scripts\check_excel_columns.py
Description: 
'''
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import openpyxl
import psycopg

from common import database_url, normalize_text
from import_excel import CORE_FIELD_MAP, LAB_START_HEADER, PRIVATE_FIELDS


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check Excel headers and imported JSONB keys.")
    parser.add_argument("--file", required=True, help="Excel file path")
    parser.add_argument("--sheet", default="汇总数据", help="Worksheet name")
    parser.add_argument(
        "--compare-db",
        action="store_true",
        help="Compare Excel headers with keys stored in sample_raw_records.raw_data",
    )
    return parser.parse_args()


def load_headers(path: Path, sheet_name: str) -> list[str]:
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb[sheet_name]
    return [normalize_text(cell.value) or "" for cell in ws[1]]


def classify_headers(headers: list[str]) -> dict[str, list[str]]:
    non_empty = [header for header in headers if header]
    lab_start_idx = headers.index(LAB_START_HEADER) if LAB_START_HEADER in headers else len(headers)
    lab_headers = [header for header in headers[lab_start_idx:] if header and not header.startswith("None.")]
    core_headers = [header for header in non_empty if header in CORE_FIELD_MAP]
    private_headers = [header for header in non_empty if header in PRIVATE_FIELDS]
    ignored_headers = [header for header in headers if not header or header.startswith("None.")]
    lab_header_set = set(lab_headers)
    core_set = set(core_headers)
    private_set = set(private_headers)
    visible_headers = [
        header
        for header in non_empty
        if header not in core_set
        and header not in private_set
        and header not in lab_header_set
        and not header.startswith("None.")
    ]
    return {
        "core_headers": core_headers,
        "private_headers": private_headers,
        "visible_headers": visible_headers,
        "lab_headers": lab_headers,
        "ignored_headers": ignored_headers,
    }


def db_raw_keys() -> set[str]:
    with psycopg.connect(database_url()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT key
                FROM sample_raw_records,
                     jsonb_object_keys(raw_data) AS key
                """
            )
            return {row[0] for row in cur.fetchall()}


def main() -> None:
    args = parse_args()
    path = Path(args.file).resolve()
    headers = load_headers(path, args.sheet)
    classified = classify_headers(headers)
    non_empty_headers = [header for header in headers if header]

    result: dict[str, Any] = {
        "file": str(path),
        "sheet": args.sheet,
        "total_columns": len(headers),
        "non_empty_headers_count": len(non_empty_headers),
        "empty_headers_count": len([header for header in headers if not header]),
        "classified_counts": {key: len(value) for key, value in classified.items()},
        "classified_headers": classified,
    }

    if args.compare_db:
        keys = db_raw_keys()
        expected = {header for header in non_empty_headers if not header.startswith("None.")}
        result["db_raw_keys_count"] = len(keys)
        result["missing_in_db_raw_data"] = sorted(expected - keys)
        result["extra_in_db_raw_data"] = sorted(keys - expected)

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
