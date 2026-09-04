from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.core.security import hash_password
from app.db.session import get_db

router = APIRouter()

UserRole = Literal["admin", "user"]
UserStatus = Literal["active", "disabled"]
AccountType = Literal["internal", "hospital"]

DEFAULT_USER_PERMISSIONS = {
    "sample_view": True,
    "lab_result_view": True,
    "sequencing_status_view": True,
}
EXTRA_USER_PERMISSIONS = {
    "sample_checkout",
    "usage_record_create",
    "batch_code_generate",
    "privacy_access_log_view",
    "hospital_data_submit",
}


class UserItem(BaseModel):
    id: int
    username: str
    display_name: str
    role: str
    is_super_admin: bool
    permissions: dict[str, Any]
    status: str
    password_reset_required: bool
    password_changed_at: datetime | None = None
    last_login_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    account_type: str = "internal"
    center_codes: list[str] = Field(default_factory=list)


class UserListResponse(BaseModel):
    items: list[UserItem]
    total: int
    page: int
    page_size: int


class CreateUserRequest(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    display_name: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=6, max_length=128)
    role: UserRole = "user"
    permissions: dict[str, Any] = Field(default_factory=dict)
    status: UserStatus = "active"
    password_reset_required: bool = True
    account_type: AccountType = "internal"
    center_codes: list[str] = Field(default_factory=list)


class UpdateUserRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=64)
    role: UserRole
    permissions: dict[str, Any] = Field(default_factory=dict)
    status: UserStatus
    password_reset_required: bool = False
    account_type: AccountType = "internal"
    center_codes: list[str] = Field(default_factory=list)


class ResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=6, max_length=128)
    password_reset_required: bool = True


def ensure_admin(current_user: CurrentUser) -> None:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有管理员可以管理用户",
        )


def ensure_super_admin(current_user: CurrentUser) -> None:
    ensure_admin(current_user)
    if not current_user.is_super_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有超级管理员可以管理管理员账号",
        )


def normalize_permissions(
    role: str,
    permissions: dict[str, Any],
    account_type: str = "internal",
) -> dict[str, Any]:
    if role == "admin":
        return {}
    if account_type == "hospital":
        return {"hospital_data_submit": True}
    normalized = {**DEFAULT_USER_PERMISSIONS}
    for key in EXTRA_USER_PERMISSIONS:
        if key in permissions:
            normalized[key] = bool(permissions[key])
    normalized.pop("hospital_data_submit", None)
    return normalized


def normalize_center_codes(
    db: Session,
    role: str,
    account_type: str,
    center_codes: list[str],
) -> list[str]:
    normalized = sorted({code.strip() for code in center_codes if code.strip()})
    if role == "admin":
        if account_type != "internal":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="管理员只能使用内部账号类型")
        return []
    if account_type == "internal":
        return []
    if len(normalized) != 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="医院账号必须绑定且只能绑定一个中心")
    valid_codes = set(
        db.execute(
            text(
                """
                SELECT center_code
                FROM centers
                WHERE is_active = true
                  AND center_code = ANY(:center_codes)
                """
            ),
            {"center_codes": normalized},
        ).scalars()
    )
    if valid_codes != set(normalized):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="绑定中心不存在或已停用")
    return normalized


def sync_center_scopes(db: Session, user_id: int, center_codes: list[str]) -> None:
    db.execute(text("DELETE FROM user_center_scopes WHERE user_id = :user_id"), {"user_id": user_id})
    for center_code in center_codes:
        db.execute(
            text(
                """
                INSERT INTO user_center_scopes (user_id, center_code)
                VALUES (:user_id, :center_code)
                ON CONFLICT (user_id, center_code) DO NOTHING
                """
            ),
            {"user_id": user_id, "center_code": center_code},
        )


def center_codes_for_user(db: Session, user_id: int) -> list[str]:
    return list(
        db.execute(
            text("SELECT center_code FROM user_center_scopes WHERE user_id = :user_id ORDER BY center_code"),
            {"user_id": user_id},
        ).scalars()
    )


def get_target_user(db: Session, user_id: int) -> dict[str, Any]:
    row = (
        db.execute(
            text(
                """
                SELECT id, username, role, is_super_admin
                FROM users
                WHERE id = :user_id
                """
            ),
            {"user_id": user_id},
        )
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    return dict(row)


def ensure_can_manage_target_admin(
    current_user: CurrentUser,
    target_user: dict[str, Any],
    next_role: str | None = None,
) -> None:
    target_is_admin = target_user["role"] == "admin" or bool(target_user["is_super_admin"])
    will_be_admin = next_role == "admin"
    if (target_is_admin or will_be_admin) and not current_user.is_super_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有超级管理员可以管理管理员账号",
        )


def build_filters(keyword: str | None, role: str | None, user_status: str | None):
    clauses = ["1 = 1"]
    params: dict[str, Any] = {}

    if keyword:
        clauses.append(
            """
            (
                username ILIKE :keyword
                OR display_name ILIKE :keyword
            )
            """
        )
        params["keyword"] = f"%{keyword.strip()}%"

    if role:
        clauses.append("role = :role")
        params["role"] = role

    if user_status:
        clauses.append("status = :status")
        params["status"] = user_status

    return " AND ".join(clauses), params


@router.get("", response_model=UserListResponse)
def list_users(
    keyword: str | None = Query(default=None),
    role: UserRole | None = Query(default=None),
    user_status: UserStatus | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> UserListResponse:
    ensure_admin(current_user)
    where_sql, params = build_filters(keyword, role, user_status)
    offset = (page - 1) * page_size

    total = db.execute(text(f"SELECT count(*) FROM users WHERE {where_sql}"), params).scalar_one()
    rows = (
        db.execute(
            text(
                f"""
                SELECT id,
                       username,
                       display_name,
                       role,
                       is_super_admin,
                       permissions,
                       status,
                       account_type,
                       password_reset_required,
                       password_changed_at,
                       last_login_at,
                       created_at,
                       updated_at,
                       COALESCE(
                           ARRAY(
                               SELECT scope.center_code
                               FROM user_center_scopes scope
                               WHERE scope.user_id = users.id
                               ORDER BY scope.center_code
                           ),
                           ARRAY[]::varchar[]
                       ) AS center_codes
                FROM users
                WHERE {where_sql}
                ORDER BY created_at DESC, id DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {**params, "limit": page_size, "offset": offset},
        )
        .mappings()
        .all()
    )

    return UserListResponse(
        items=[UserItem(**row) for row in rows],
        total=int(total),
        page=page,
        page_size=page_size,
    )


@router.post("", response_model=UserItem)
def create_user(
    payload: CreateUserRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> UserItem:
    ensure_admin(current_user)
    if payload.role == "admin":
        ensure_super_admin(current_user)
    center_codes = normalize_center_codes(db, payload.role, payload.account_type, payload.center_codes)
    permissions = normalize_permissions(payload.role, payload.permissions, payload.account_type)

    try:
        row = (
            db.execute(
                text(
                    """
                    INSERT INTO users (
                        username,
                        password_hash,
                        password_reset_required,
                        display_name,
                        role,
                        is_super_admin,
                        permissions,
                        status,
                        account_type
                    )
                    VALUES (
                        :username,
                        :password_hash,
                        :password_reset_required,
                        :display_name,
                        :role,
                        false,
                        CAST(:permissions AS jsonb),
                        :status,
                        :account_type
                    )
                    RETURNING id,
                              username,
                              display_name,
                              role,
                              is_super_admin,
                              permissions,
                              status,
                              account_type,
                              password_reset_required,
                              password_changed_at,
                              last_login_at,
                              created_at,
                              updated_at
                    """
                ),
                {
                    "username": payload.username.strip(),
                    "password_hash": hash_password(payload.password),
                    "password_reset_required": payload.password_reset_required,
                    "display_name": payload.display_name.strip(),
                    "role": payload.role,
                    "permissions": json.dumps(permissions, ensure_ascii=False),
                    "status": payload.status,
                    "account_type": payload.account_type,
                },
            )
            .mappings()
            .one()
        )
        sync_center_scopes(db, int(row["id"]), center_codes)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="账号已存在")

    return UserItem(**dict(row), center_codes=center_codes)


@router.put("/{user_id}", response_model=UserItem)
def update_user(
    user_id: int,
    payload: UpdateUserRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> UserItem:
    ensure_admin(current_user)
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="不能在用户管理中修改当前登录账号的角色、状态或权限",
        )
    target_user = get_target_user(db, user_id)
    ensure_can_manage_target_admin(current_user, target_user, payload.role)

    center_codes = normalize_center_codes(db, payload.role, payload.account_type, payload.center_codes)
    permissions = normalize_permissions(payload.role, payload.permissions, payload.account_type)
    row = (
        db.execute(
            text(
                """
                UPDATE users
                SET display_name = :display_name,
                    role = :role,
                    permissions = CAST(:permissions AS jsonb),
                    status = :status,
                    account_type = :account_type,
                    password_reset_required = :password_reset_required,
                    token_version = token_version + CASE
                        WHEN status IS DISTINCT FROM :status
                          OR password_reset_required IS DISTINCT FROM :password_reset_required
                        THEN 1 ELSE 0 END,
                    updated_at = now()
                WHERE id = :user_id
                RETURNING id,
                          username,
                          display_name,
                          role,
                          is_super_admin,
                          permissions,
                          status,
                          account_type,
                          password_reset_required,
                          password_changed_at,
                          last_login_at,
                          created_at,
                          updated_at
                """
            ),
            {
                "user_id": user_id,
                "display_name": payload.display_name.strip(),
                "role": payload.role,
                "permissions": json.dumps(permissions, ensure_ascii=False),
                "status": payload.status,
                "account_type": payload.account_type,
                "password_reset_required": payload.password_reset_required,
            },
        )
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    sync_center_scopes(db, user_id, center_codes)
    db.commit()
    return UserItem(**dict(row), center_codes=center_codes)


@router.post("/{user_id}/reset-password", response_model=UserItem)
def reset_user_password(
    user_id: int,
    payload: ResetPasswordRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> UserItem:
    ensure_admin(current_user)
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="当前登录账号请使用右上角的修改密码功能",
        )
    target_user = get_target_user(db, user_id)
    ensure_can_manage_target_admin(current_user, target_user)
    row = (
        db.execute(
            text(
                """
                UPDATE users
                SET password_hash = :password_hash,
                    password_changed_at = now(),
                    password_reset_required = :password_reset_required,
                    token_version = token_version + 1,
                    updated_at = now()
                WHERE id = :user_id
                RETURNING id,
                          username,
                          display_name,
                          role,
                          is_super_admin,
                          permissions,
                          status,
                          account_type,
                          password_reset_required,
                          password_changed_at,
                          last_login_at,
                          created_at,
                          updated_at
                """
            ),
            {
                "user_id": user_id,
                "password_hash": hash_password(payload.new_password),
                "password_reset_required": payload.password_reset_required,
            },
        )
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    db.commit()
    return UserItem(**dict(row), center_codes=center_codes_for_user(db, user_id))
