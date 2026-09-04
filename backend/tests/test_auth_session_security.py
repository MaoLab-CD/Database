from __future__ import annotations

from typing import Any

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from starlette.requests import Request

import app.api.deps as deps


class FakeResult:
    def __init__(self, row: dict[str, Any]) -> None:
        self.row = row

    def mappings(self) -> "FakeResult":
        return self

    def first(self) -> dict[str, Any]:
        return self.row


class FakeSession:
    def __init__(self, row: dict[str, Any]) -> None:
        self.row = row

    def execute(self, *_args: Any, **_kwargs: Any) -> FakeResult:
        return FakeResult(self.row)


def build_request(path: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": path,
            "headers": [],
            "client": ("127.0.0.1", 12345),
        }
    )


def user_row(*, token_version: int = 2, reset_required: bool = False) -> dict[str, Any]:
    return {
        "id": 1,
        "username": "tester",
        "display_name": "Tester",
        "role": "user",
        "is_super_admin": False,
        "permissions": {},
        "status": "active",
        "password_reset_required": reset_required,
        "token_version": token_version,
        "account_type": "internal",
        "center_codes": [],
        "center_names": {},
    }


def credentials() -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials="test-token")


def test_old_token_version_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(deps, "decode_access_token", lambda _token: {"sub": "tester", "ver": 1})

    with pytest.raises(HTTPException) as exc_info:
        deps.get_current_user(
            build_request("/api/samples"),
            credentials(),
            FakeSession(user_row(token_version=2)),
        )

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "登录状态已更新，请重新登录"


def test_missing_token_version_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(deps, "decode_access_token", lambda _token: {"sub": "tester"})

    with pytest.raises(HTTPException) as exc_info:
        deps.get_current_user(
            build_request("/api/samples"),
            credentials(),
            FakeSession(user_row()),
        )

    assert exc_info.value.status_code == 401


def test_password_reset_required_blocks_business_api(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(deps, "decode_access_token", lambda _token: {"sub": "tester", "ver": 2})

    with pytest.raises(HTTPException) as exc_info:
        deps.get_current_user(
            build_request("/api/samples"),
            credentials(),
            FakeSession(user_row(reset_required=True)),
        )

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "当前账号必须先修改密码"


@pytest.mark.parametrize("path", ["/api/auth/me", "/api/auth/change-password"])
def test_password_reset_required_allows_account_endpoints(
    monkeypatch: pytest.MonkeyPatch,
    path: str,
) -> None:
    monkeypatch.setattr(deps, "decode_access_token", lambda _token: {"sub": "tester", "ver": 2})

    current_user = deps.get_current_user(
        build_request(path),
        credentials(),
        FakeSession(user_row(reset_required=True)),
    )

    assert current_user.username == "tester"
    assert current_user.password_reset_required is True
