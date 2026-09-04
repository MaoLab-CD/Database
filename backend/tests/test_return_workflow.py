from app.api.routes.returns import (
    build_plate_storage_location,
    resolve_final_storage_location,
)


def plate_well() -> dict[str, object]:
    return {
        "plate_code": "BZTD2400001815",
        "well_code": "A01",
        "freezer_code": "448-02",
        "temperature_c": -80,
        "layer_no": "II",
        "container_no": "3",
    }


def test_dna_return_uses_current_plate_well_location() -> None:
    location = resolve_final_storage_location(
        "in_storage",
        "DNA",
        "用户提交的旧位置",
        "出库前位置",
        plate_well(),
    )

    assert location == "448-02 -80 °C / II层 / 3号盒 / BZTD2400001815 / A01"


def test_terminal_return_status_clears_current_location() -> None:
    for final_status in ("consumed", "lost", "discarded"):
        assert (
            resolve_final_storage_location(
                final_status,
                "DNA",
                "申请归还位置",
                "原位置",
                plate_well(),
            )
            is None
        )


def test_non_dna_return_prefers_requested_location() -> None:
    assert (
        resolve_final_storage_location(
            "in_storage",
            "全血",
            "448-01 -40 °C / I层 / 2号盒",
            "旧位置",
            None,
        )
        == "448-01 -40 °C / I层 / 2号盒"
    )


def test_plate_location_allows_missing_freezer_fields() -> None:
    assert build_plate_storage_location(
        {
            "plate_code": "PLATE-01",
            "well_code": "H12",
            "freezer_code": None,
            "temperature_c": None,
            "layer_no": None,
            "container_no": None,
        }
    ) == "PLATE-01 / H12"
