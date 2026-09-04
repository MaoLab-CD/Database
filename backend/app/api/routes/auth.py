from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.core.config import settings
from app.core.security import create_access_token, hash_password, verify_password
from app.db.session import get_db
from app.services.login_rate_limit import (
    cleanup_stale_limits,
    clear_login_failures,
    locked_until_for,
    login_identifiers,
    record_login_failure,
)

router = APIRouter()


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=256)
    remember_me: bool = False


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str
    display_name: str
    role: str
    is_super_admin: bool
    permissions: dict[str, Any]
    password_reset_required: bool
    account_type: str
    center_codes: list[str]
    center_names: dict[str, str]


class CurrentUserResponse(BaseModel):
    username: str
    display_name: str
    role: str
    is_super_admin: bool
    permissions: dict[str, Any]
    password_reset_required: bool
    account_type: str
    center_codes: list[str]
    center_names: dict[str, str]


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


@router.post("/login", response_model=LoginResponse)
def login(
    payload: LoginRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> LoginResponse:
    identifiers = login_identifiers(payload.username, request)
    cleanup_stale_limits(db)
    if locked_until_for(db, identifiers) is not None:
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="登录失败次数过多，请 15 分钟后再试",
            headers={"Retry-After": "900"},
        )

    user = db.execute(
        text(
            """
            SELECT username,
                   password_hash,
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
        {"username": payload.username},
    ).mappings().first()

    if (
        user is None
        or user["status"] != "active"
        or not verify_password(payload.password, user["password_hash"])
    ):
        locked_until = record_login_failure(db, identifiers)
        db.commit()
        if locked_until is not None:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="登录失败次数过多，请 15 分钟后再试",
                headers={"Retry-After": "900"},
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
        )

    clear_login_failures(db, identifiers)
    db.commit()
    expire_minutes = (
        7 * 24 * 60 if payload.remember_me else settings.access_token_expire_minutes
    )

    return LoginResponse(
        access_token=create_access_token(
            subject=user["username"],
            extra_claims={
                "role": user["role"],
                "ver": int(user["token_version"]),
            },
            expire_minutes=expire_minutes,
        ),
        username=user["username"],
        display_name=user["display_name"],
        role=user["role"],
        is_super_admin=bool(user["is_super_admin"]),
        permissions=user["permissions"] or {},
        password_reset_required=bool(user["password_reset_required"]),
        account_type=user["account_type"] or "internal",
        center_codes=list(user["center_codes"] or []),
        center_names=dict(user["center_names"] or {}),
    )


@router.get("/me", response_model=CurrentUserResponse)
def me(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUserResponse:
    return CurrentUserResponse(
        username=current_user.username,
        display_name=current_user.display_name,
        role=current_user.role,
        is_super_admin=current_user.is_super_admin,
        permissions=current_user.permissions,
        password_reset_required=current_user.password_reset_required,
        account_type=current_user.account_type,
        center_codes=list(current_user.center_codes),
        center_names=dict(current_user.center_names or {}),
    )


@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    if len(payload.new_password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="新密码长度至少 6 位",
        )
    if payload.old_password == payload.new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="新密码不能与旧密码相同",
        )

    user = (
        db.execute(
            text(
                """
                SELECT password_hash
                FROM users
                WHERE username = :username
                """
            ),
            {"username": current_user.username},
        )
        .mappings()
        .first()
    )

    if user is None or not verify_password(payload.old_password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="旧密码不正确",
        )

    db.execute(
        text(
            """
            UPDATE users
            SET password_hash = :password_hash,
                password_changed_at = now(),
                password_reset_required = false,
                token_version = token_version + 1,
                updated_at = now()
            WHERE username = :username
            """
        ),
        {
            "password_hash": hash_password(payload.new_password),
            "username": current_user.username,
        },
    )
    db.commit()
    return {"success": True}
