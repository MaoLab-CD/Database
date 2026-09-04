from __future__ import annotations

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.api.deps import CurrentUser, get_current_user, require_internal_user
from app.api.routes.users import normalize_permissions
from app.main import app


def hospital_user() -> CurrentUser:
    return CurrentUser(
        id=101,
        username="hospital-upload-only",
        display_name="Hospital Upload User",
        role="user",
        is_super_admin=False,
        permissions={
            "hospital_data_submit": True,
            "sample_checkout": True,
            "batch_code_generate": True,
        },
        password_reset_required=False,
        account_type="hospital",
        center_codes=("510115-001",),
        center_names={"510115-001": "温江区人民医院"},
    )


def test_hospital_permissions_are_forced_to_upload_only() -> None:
    normalized = normalize_permissions(
        "user",
        {
            "sample_checkout": True,
            "usage_record_create": True,
            "batch_code_generate": True,
            "privacy_access_log_view": True,
        },
        "hospital",
    )

    assert normalized == {"hospital_data_submit": True}


def test_internal_guard_rejects_hospital_account() -> None:
    with pytest.raises(HTTPException) as exc_info:
        require_internal_user(hospital_user())

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "医院账号仅允许使用数据上传功能"


def test_every_internal_api_route_has_hospital_account_guard() -> None:
    unguarded: list[str] = []
    allowed_prefixes = ("/api/auth", "/api/hospital-uploads")

    for route in app.routes:
        if not isinstance(route, APIRoute) or not route.path.startswith("/api"):
            continue
        if route.path.startswith(allowed_prefixes):
            continue
        if not any(dependency.call is require_internal_user for dependency in route.dependant.dependencies):
            unguarded.append(route.path)

    assert unguarded == []


def test_hospital_account_can_still_download_upload_template() -> None:
    app.dependency_overrides[get_current_user] = hospital_user
    try:
        response = TestClient(app).get("/api/hospital-uploads/template")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


def test_hospital_account_is_blocked_from_internal_api() -> None:
    app.dependency_overrides[get_current_user] = hospital_user
    try:
        response = TestClient(app).get("/api/dashboard/summary")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 403
    assert response.json()["detail"] == "医院账号仅允许使用数据上传功能"
