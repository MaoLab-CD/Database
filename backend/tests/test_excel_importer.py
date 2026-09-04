from app.services.excel_importer import (
    build_payload,
    resolve_import_batch_status,
    resolve_import_sample_status,
)


def test_new_sample_uses_selected_initial_status() -> None:
    assert resolve_import_sample_status(None, "in_storage") == "in_storage"


def test_overwrite_preserves_active_inventory_status() -> None:
    assert resolve_import_sample_status("checked_out", "in_storage") == "checked_out"
    assert resolve_import_sample_status("return_pending", "in_storage") == "return_pending"


def test_overwrite_preserves_terminal_inventory_status() -> None:
    assert resolve_import_sample_status("consumed", "in_storage") == "consumed"
    assert resolve_import_sample_status("lost", "in_storage") == "lost"
    assert resolve_import_sample_status("discarded", "in_storage") == "discarded"


def test_import_batch_status_distinguishes_partial_success() -> None:
    assert resolve_import_batch_status(3, 0) == "imported"
    assert resolve_import_batch_status(3, 1) == "partial"
    assert resolve_import_batch_status(0, 1) == "failed"


def test_build_payload_removes_private_plaintext_from_raw_data() -> None:
    payload = build_payload(
        headers=["序", "姓名", "身份证号", "电话", "地址", "医院自定义字段"],
        row_values=("123456", "测试姓名", "510000000000000000", "13800000000", "测试地址", "保留字段"),
        row_number=2,
        allow_nonstandard=False,
    )

    assert payload["private"] == {
        "name": "测试姓名",
        "id_card_no": "510000000000000000",
        "phone": "13800000000",
        "address": "测试地址",
    }
    assert payload["raw_data"] == {"序": "123456", "医院自定义字段": "保留字段"}
    assert payload["visible_data"] == {"医院自定义字段": "保留字段"}
