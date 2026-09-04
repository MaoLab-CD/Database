from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.session import get_db

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class CurrentUser:
    id: int
    username: str
    display_name: str
    role: str
    is_super_admin: bool
    permissions: dict[str, Any]
    password_reset_required: bool
    account_type: str = "internal"
    center_codes: tuple[str, ...] = ()
    center_names: dict[str, str] | None = None


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> CurrentUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未登录或登录已失效",
        )

    payload = decode_access_token(credentials.credentials)
    if payload is None or not payload.get("sub"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未登录或登录已失效",
        )

    user = (
        db.execute(
            text(
                """
                SELECT id,
                       username,
                       display_name,
                       role,
                       is_super_admin,
                       permissions,
                       status,
                       password_reset_required,
                       token_version,
                       account_type,
                       COALESCE(
                           ARRAY(
                               SELECT scope.center_code
                               FROM user_center_scopes scope
                               WHERE scope.user_id = users.id
                               ORDER BY scope.center_code
                           ),
                           ARRAY[]::varchar[]
                       ) AS center_codes,
                       COALESCE(
                           (
                               SELECT jsonb_object_agg(scope.center_code, centers.center_name)
                               FROM user_center_scopes scope
                               JOIN centers ON centers.center_code = scope.center_code
                               WHERE scope.user_id = users.id
                           ),
                           '{}'::jsonb
                       ) AS center_names
                FROM users
                WHERE username = :username
                """
            ),
            {"username": payload["sub"]},
        )
        .mappings()
        .first()
    )

    if user is None or user["status"] != "active":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户不存在或已停用",
        )

    token_version = payload.get("ver")
    if (
        not isinstance(token_version, int)
        or isinstance(token_version, bool)
        or token_version != int(user["token_version"])
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登录状态已更新，请重新登录",
        )

    if bool(user["password_reset_required"]) and request.url.path not in {
        "/api/auth/me",
        "/api/auth/change-password",
    }:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="当前账号必须先修改密码",
        )

    return CurrentUser(
        id=user["id"],
        username=user["username"],
        display_name=user["display_name"],
        role=user["role"],
        is_super_admin=bool(user["is_super_admin"]),
        permissions=user["permissions"] or {},
        password_reset_required=bool(user["password_reset_required"]),
        account_type=user["account_type"] or "internal",
        center_codes=tuple(user["center_codes"] or ()),
        center_names=dict(user["center_names"] or {}),
    )


def require_internal_user(
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Reject hospital upload-only accounts from every internal business API."""
    if current_user.account_type == "hospital":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="医院账号仅允许使用数据上传功能",
        )
    return current_user
