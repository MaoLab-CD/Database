from pathlib import Path

import openpyxl

from app.services.dna_plate_importer import _parse_rows


def build_workbook(path: Path, rows: list[list[str]]) -> None:
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "汇总数据"
    sheet.append(
        [
            "序",
            "sample_code",
            "条码号",
            "实验号",
            "来源",
            "分装编号",
            "样本板号Sample Plate Number",
            "样本孔号Sample Well Number",
        ]
    )
    for row in rows:
        sheet.append(row)
    workbook.save(path)
    workbook.close()


def test_parse_dna_plate_rows_without_note_column(tmp_path: Path) -> None:
    path = tmp_path / "dna_plate.xlsx"
    build_workbook(
        path,
        [
            [
                "10701",
                "510115-001-2601070001d",
                "XZTD260013411-1A",
                "XZTD260013411-1A",
                "DNA返还",
                "XZTD260013411-1A",
                "bztd2400001815",
                "a01",
            ]
        ],
    )

    rows, errors = _parse_rows(path, "汇总数据")

    assert errors == []
    assert len(rows) == 1
    assert rows[0].sample_code == "510115-001-2601070001d"
    assert rows[0].plate_code == "BZTD2400001815"
    assert rows[0].well_code == "A01"


def test_parse_dna_plate_rows_rejects_duplicate_position(tmp_path: Path) -> None:
    path = tmp_path / "duplicate_position.xlsx"
    build_workbook(
        path,
        [
            [
                "10701",
                "510115-001-2601070001d",
                "",
                "",
                "",
                "",
                "BZTD2400001815",
                "A01",
            ],
            [
                "10702",
                "510115-001-2601070002d",
                "",
                "",
                "",
                "",
                "BZTD2400001815",
                "A01",
            ],
        ],
    )

    rows, errors = _parse_rows(path, "汇总数据")

    assert len(rows) == 1
    assert len(errors) == 1
    assert "板号与孔位组合在文件内重复" in errors[0]["reason"]


def test_parse_dna_plate_rows_requires_dna_suffix(tmp_path: Path) -> None:
    path = tmp_path / "blood_code.xlsx"
    build_workbook(
        path,
        [
            [
                "10701",
                "510115-001-2601070001",
                "",
                "",
                "",
                "",
                "BZTD2400001815",
                "A01",
            ]
        ],
    )

    rows, errors = _parse_rows(path, "汇总数据")

    assert rows == []
    assert len(errors) == 1
    assert "小写 d" in errors[0]["reason"]
