from __future__ import annotations

import unittest
from io import BytesIO

from openpyxl import Workbook

from app.services.workbook_loader import is_legacy_xls, load_excel_workbook


class WorkbookLoaderTest(unittest.TestCase):
    def test_xlsx_content_with_xls_suffix_uses_ooxml_loader(self) -> None:
        source = Workbook()
        source.active.title = "样本信息1"
        source.active["A1"] = "样本名称 Sample Name"
        output = BytesIO()
        source.save(output)
        source.close()

        content = output.getvalue()
        self.assertFalse(is_legacy_xls(content, ".xls"))

        loaded = load_excel_workbook(content, ".xls", read_only=True, data_only=True)
        try:
            self.assertEqual(loaded.sheetnames, ["样本信息1"])
            self.assertEqual(loaded["样本信息1"]["A1"].value, "样本名称 Sample Name")
        finally:
            loaded.close()

    def test_ole2_signature_wins_over_xlsx_suffix(self) -> None:
        content = bytes.fromhex("D0CF11E0A1B11AE1") + b"placeholder"
        self.assertTrue(is_legacy_xls(content, ".xlsx"))


if __name__ == "__main__":
    unittest.main()
