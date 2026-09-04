from __future__ import annotations

import argparse
from pathlib import Path

import openpyxl
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation


DEFAULT_SOURCE_FILE = Path(r"D:\desktop\sample_admin\附件\少数民族数据汇总 2025.5.1-31_filled.xlsx")
DEFAULT_OUTPUT_FILE = Path(__file__).resolve().parents[1] / "uploads" / "genome_info_fill_template.xlsx"
DEFAULT_SHEET_NAME = "汇总数据"

SAMPLE_CODE_HEADERS = ("sample_code", "样本编码", "正式编码", "贴标编码")

TEMPLATE_HEADERS = [
    "sample_code",
    "基因组数据状态",
    "数据类型",
    "测序公司",
    "测序平台",
    "测序仪器",
    "回库时间",
    "测序深度",
    "基因组QC",
    "最终状态",
    "不可用原因",
]

FIELD_NOTES = [
    ("sample_code", "系统正式样本编码。脚本自动带出，请不要修改。", "510105-001-2606290001"),
    ("基因组数据状态", "数据是否已返回、是否完整等状态。", "已完成 / 未返回 / 部分缺失"),
    ("数据类型", "测序或数据类型。", "WGS / WES / panel"),
    ("测序公司", "承接测序的公司或机构名称。", "华大基因"),
    ("测序平台", "测序平台名称。", "DNBSEQ / Illumina"),
    ("测序仪器", "具体仪器型号。", "DNBSEQ-T7 / NovaSeq 6000"),
    ("回库时间", "测序结果或样本回库日期，建议填写 YYYY-MM-DD。", "2026-06-15"),
    ("测序深度", "测序深度或覆盖度。", "30x"),
    ("基因组QC", "基因组质控结论。", "合格 / 不合格 / 待确认"),
    ("最终状态", "最终业务可用状态。", "可用 / 不可用 / 待确认"),
    ("不可用原因", "仅当最终状态不可用时填写原因。", "数据缺失 / QC不合格"),
]

FIELD_NOTE_MAP = {field: note for field, note, _example in FIELD_NOTES}

EXAMPLE_ROW_VALUES = [
    "已完成",
    "WGS",
    "华大基因",
    "DNBSEQ",
    "DNBSEQ-T7",
    "2026-06-15",
    "30x",
    "合格",
    "可用",
    "",
]


def normalize_cell(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def find_sample_code_column(headers: list[str]) -> int:
    for header in SAMPLE_CODE_HEADERS:
        if header in headers:
            return headers.index(header)
    raise ValueError(f"未找到样本编码列，支持列名：{', '.join(SAMPLE_CODE_HEADERS)}")


def read_sample_codes(source_file: Path, sheet_name: str, limit: int | None) -> list[str]:
    wb = openpyxl.load_workbook(source_file, read_only=True, data_only=True)
    try:
        if sheet_name not in wb.sheetnames:
            raise ValueError(f"工作表不存在：{sheet_name}，可用工作表：{', '.join(wb.sheetnames)}")

        ws = wb[sheet_name]
        headers = [normalize_cell(cell.value) for cell in ws[1]]
        sample_code_col = find_sample_code_column(headers)

        codes: list[str] = []
        seen: set[str] = set()
        for row in ws.iter_rows(min_row=2, values_only=True):
            code = normalize_cell(row[sample_code_col] if sample_code_col < len(row) else None)
            if not code or code in seen:
                continue
            codes.append(code)
            seen.add(code)
            if limit is not None and len(codes) >= limit:
                break
        return codes
    finally:
        wb.close()


def style_template_sheet(ws: openpyxl.worksheet.worksheet.Worksheet, row_count: int) -> None:
    header_fill = PatternFill("solid", fgColor="D9EAF7")
    required_fill = PatternFill("solid", fgColor="FFF2CC")

    for col_index, header in enumerate(TEMPLATE_HEADERS, start=1):
        cell = ws.cell(row=1, column=col_index)
        cell.font = Font(bold=True)
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.fill = required_fill if header == "sample_code" else header_fill
        cell.comment = Comment(FIELD_NOTE_MAP.get(header, ""), "Codex")

    widths = {
        "A": 24,
        "B": 18,
        "C": 14,
        "D": 18,
        "E": 18,
        "F": 18,
        "G": 14,
        "H": 14,
        "I": 14,
        "J": 14,
        "K": 28,
    }
    for column, width in widths.items():
        ws.column_dimensions[column].width = width

    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:K{max(row_count + 1, 2)}"

    if row_count > 0:
        date_validation = DataValidation(
            type="date",
            operator="between",
            formula1="DATE(2000,1,1)",
            formula2="DATE(2099,12,31)",
            allow_blank=True,
        )
        date_validation.error = "请填写日期格式，例如 2026-06-15。"
        date_validation.errorTitle = "日期格式不正确"
        ws.add_data_validation(date_validation)
        date_validation.add(f"G2:G{row_count + 1}")


def add_notes_sheet(wb: openpyxl.Workbook) -> None:
    ws = wb.create_sheet("填写说明")
    ws.append(["字段", "填写说明", "示例"])
    ws.append(["整体说明", "汇总数据第一条样本记录已填入示例值，仅用于展示填写格式；请按真实情况修改或清空。", ""])
    for field, note, example in FIELD_NOTES:
        ws.append([field, note, example])

    for cell in ws[1]:
        cell.font = Font(bold=True)
        cell.fill = PatternFill("solid", fgColor="D9EAF7")
        cell.alignment = Alignment(horizontal="center", vertical="center")

    ws.column_dimensions["A"].width = 20
    ws.column_dimensions["B"].width = 54
    ws.column_dimensions["C"].width = 28
    ws.freeze_panes = "A2"

    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = Alignment(wrap_text=True, vertical="top")


def write_template(codes: list[str], output_file: Path) -> None:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = DEFAULT_SHEET_NAME
    ws.append(TEMPLATE_HEADERS)

    for index, code in enumerate(codes):
        if index == 0:
            ws.append([code, *EXAMPLE_ROW_VALUES])
            continue
        ws.append([code, "", "", "", "", "", "", "", "", "", ""])

    style_template_sheet(ws, len(codes))
    add_notes_sheet(wb)

    output_file.parent.mkdir(parents=True, exist_ok=True)
    wb.save(output_file)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成基因组信息填报模板，只预填 sample_code。")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE_FILE, help="来源样本 Excel 文件")
    parser.add_argument("--sheet", default=DEFAULT_SHEET_NAME, help="来源工作表名称")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_FILE, help="输出模板文件")
    parser.add_argument("--limit", type=int, default=0, help="最多导出多少个样本编码；0 表示全部")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    limit = args.limit if args.limit > 0 else None
    codes = read_sample_codes(args.source, args.sheet, limit)
    if not codes:
        raise ValueError("未提取到任何 sample_code")

    write_template(codes, args.output)
    print(f"已生成：{args.output}")
    print(f"样本编码数量：{len(codes)}")


if __name__ == "__main__":
    main()
