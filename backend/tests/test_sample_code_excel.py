from __future__ import annotations

from datetime import date

import pytest
from openpyxl import Workbook

from app.services.sample_code_excel import (
    SampleCodeInput,
    allocate_sample_codes,
    build_excel_code_inputs,
)
from app.services.sample_codes import DEFAULT_SAMPLE_CODE_RULES


class _CenterResult:
    def scalar_one_or_none(self):
        return 1


class _CenterSession:
    def execute(self, statement, params=None):
        return _CenterResult()


def _worksheet(rows: list[tuple[str, object | None]]):
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.append(["序", "sample_code", "采集时间"])
    for sample_id, collection_time in rows:
        worksheet.append([sample_id, None, collection_time])
    return workbook, worksheet


def test_wenjiang_missing_collection_date_is_inferred_from_sequence() -> None:
    workbook, worksheet = _worksheet(
        [
            ("072701", None),
            ("072702", "2026-07-27 13:25:38"),
            ("072801", None),
        ]
    )
    try:
        rows = build_excel_code_inputs(
            worksheet,
            sequence_column=1,
            collection_column=3,
            code_column=2,
            center_code="510115-001",
            sample_type="全血",
        )
    finally:
        workbook.close()

    assert [row.collection_date for row in rows] == [
        date(2026, 7, 27),
        date(2026, 7, 27),
        date(2026, 7, 28),
    ]


def test_other_center_still_rejects_missing_collection_date() -> None:
    workbook, worksheet = _worksheet(
        [("072701", None), ("072702", "2026-07-27 13:25:38")]
    )
    try:
        with pytest.raises(ValueError, match="第 2 行：采集时间为空"):
            build_excel_code_inputs(
                worksheet,
                sequence_column=1,
                collection_column=3,
                code_column=2,
                center_code="510105-001",
                sample_type="全血",
            )
    finally:
        workbook.close()


def test_wenjiang_fallback_requires_at_least_one_known_year() -> None:
    workbook, worksheet = _worksheet([("072701", None), ("072702", None)])
    try:
        with pytest.raises(ValueError, match="至少有一条有效采集时间"):
            build_excel_code_inputs(
                worksheet,
                sequence_column=1,
                collection_column=3,
                code_column=2,
                center_code="510115-001",
                sample_type="全血",
            )
    finally:
        workbook.close()


def test_wenjiang_fallback_rejects_sequence_date_mismatch() -> None:
    workbook, worksheet = _worksheet(
        [("072701", None), ("072802", "2026-07-27 13:25:38")]
    )
    try:
        with pytest.raises(ValueError, match="与“序” 072802 的日期不一致"):
            build_excel_code_inputs(
                worksheet,
                sequence_column=1,
                collection_column=3,
                code_column=2,
                center_code="510115-001",
                sample_type="全血",
            )
    finally:
        workbook.close()


def test_existing_code_column_is_read_for_idempotent_generation() -> None:
    workbook, worksheet = _worksheet([("090201", "2026-09-02")])
    worksheet.cell(row=2, column=2).value = "510115-001-2609020001S"
    try:
        rows = build_excel_code_inputs(
            worksheet,
            sequence_column=1,
            collection_column=3,
            code_column=2,
            center_code="510115-001",
            sample_type="血清",
        )
    finally:
        workbook.close()

    assert rows[0].existing_sample_code == "510115-001-2609020001S"


def test_serum_uses_confirmed_uppercase_s_suffix(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.sample_code_excel.get_database_max_serials",
        lambda *args, **kwargs: {"260902": 4},
    )
    rows = [SampleCodeInput(2, "SERUM-01", date(2026, 9, 2), "血清")]

    assignments, _ = allocate_sample_codes(
        _CenterSession(),
        "510105-001",
        rows,
        allowed_specimen_types={"血清"},
        code_rules=DEFAULT_SAMPLE_CODE_RULES,
    )

    assert assignments[0].sample_code == "510105-001-2609020005S"
    assert assignments[0].assignment_source == "generated"


def test_existing_database_identity_reuses_original_code(monkeypatch) -> None:
    existing_code = "510115-001-2609020012"
    identity = ("090201", "全血", "260902")
    monkeypatch.setattr(
        "app.services.sample_code_excel.get_database_max_serials",
        lambda *args, **kwargs: {"260902": 12},
    )
    monkeypatch.setattr(
        "app.services.sample_code_excel.get_existing_sample_codes_by_identity",
        lambda *args, **kwargs: {identity: [existing_code]},
    )
    monkeypatch.setattr(
        "app.services.sample_code_excel.get_sample_code_owners",
        lambda *args, **kwargs: {},
    )

    assignments, _ = allocate_sample_codes(
        _CenterSession(),
        "510115-001",
        [SampleCodeInput(2, "090201", date(2026, 9, 2), "全血")],
        allowed_specimen_types={"全血"},
        code_rules=DEFAULT_SAMPLE_CODE_RULES,
        reuse_existing=True,
    )

    assert assignments[0].sample_code == existing_code
    assert assignments[0].assignment_source == "reused"


def test_valid_code_already_in_excel_is_preserved(monkeypatch) -> None:
    existing_code = "510115-001-2609020012"
    identity = ("090201", "全血", "260902")
    monkeypatch.setattr(
        "app.services.sample_code_excel.get_database_max_serials",
        lambda *args, **kwargs: {"260902": 12},
    )
    monkeypatch.setattr(
        "app.services.sample_code_excel.get_existing_sample_codes_by_identity",
        lambda *args, **kwargs: {identity: [existing_code]},
    )
    monkeypatch.setattr(
        "app.services.sample_code_excel.get_sample_code_owners",
        lambda *args, **kwargs: {existing_code: identity},
    )

    assignments, _ = allocate_sample_codes(
        _CenterSession(),
        "510115-001",
        [
            SampleCodeInput(
                2,
                "090201",
                date(2026, 9, 2),
                "全血",
                existing_sample_code=existing_code,
            )
        ],
        allowed_specimen_types={"全血"},
        code_rules=DEFAULT_SAMPLE_CODE_RULES,
        reuse_existing=True,
    )

    assert assignments[0].sample_code == existing_code
    assert assignments[0].assignment_source == "provided"


def test_conflicting_excel_and_database_codes_are_rejected(monkeypatch) -> None:
    identity = ("090201", "全血", "260902")
    monkeypatch.setattr(
        "app.services.sample_code_excel.get_database_max_serials",
        lambda *args, **kwargs: {"260902": 12},
    )
    monkeypatch.setattr(
        "app.services.sample_code_excel.get_existing_sample_codes_by_identity",
        lambda *args, **kwargs: {identity: ["510115-001-2609020012"]},
    )
    monkeypatch.setattr(
        "app.services.sample_code_excel.get_sample_code_owners",
        lambda *args, **kwargs: {},
    )

    with pytest.raises(ValueError, match="数据库编码为"):
        allocate_sample_codes(
            _CenterSession(),
            "510115-001",
            [
                SampleCodeInput(
                    2,
                    "090201",
                    date(2026, 9, 2),
                    "全血",
                    existing_sample_code="510115-001-2609020011",
                )
            ],
            allowed_specimen_types={"全血"},
            code_rules=DEFAULT_SAMPLE_CODE_RULES,
            reuse_existing=True,
        )
