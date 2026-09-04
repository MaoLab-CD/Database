from __future__ import annotations

import argparse
import base64
import getpass
import hashlib
import os

PBKDF2_ITERATIONS = 260_000
MIN_PASSWORD_LENGTH = 6
MAX_PASSWORD_LENGTH = 128


def connect_database():
    import psycopg

    from common import database_url

    return psycopg.connect(database_url())


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PBKDF2_ITERATIONS,
    )
    return "pbkdf2_sha256${}${}${}".format(
        PBKDF2_ITERATIONS,
        base64.urlsafe_b64encode(salt).decode("ascii"),
        base64.urlsafe_b64encode(digest).decode("ascii"),
    )


def user_exists(username: str) -> bool:
    with connect_database() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM users WHERE username = %s", (username,))
            return cur.fetchone() is not None


def prompt_password(username: str) -> str:
    password = getpass.getpass("请输入超级管理员密码：")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"密码至少需要 {MIN_PASSWORD_LENGTH} 位")
    if len(password) > MAX_PASSWORD_LENGTH:
        raise ValueError(f"密码不能超过 {MAX_PASSWORD_LENGTH} 位")
    if password.casefold() == username.casefold():
        raise ValueError("密码不能与用户名相同")

    confirmation = getpass.getpass("请再次输入密码：")
    if password != confirmation:
        raise ValueError("两次输入的密码不一致")
    return password


def save_super_admin(
    username: str,
    display_name: str,
    password: str,
    reset_password: bool,
) -> str:
    password_hash = hash_password(password)
    with connect_database() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE username = %s", (username,))
            exists = cur.fetchone() is not None

            if exists:
                if not reset_password:
                    return "skipped"
                cur.execute(
                    """
                    UPDATE users
                    SET password_hash = %s,
                        password_changed_at = now(),
                        password_reset_required = false,
                        token_version = token_version + 1,
                        display_name = %s,
                        role = 'admin',
                        is_super_admin = true,
                        permissions = '{}'::jsonb,
                        status = 'active',
                        updated_at = now()
                    WHERE username = %s
                    """,
                    (password_hash, display_name, username),
                )
                action = "reset"
            else:
                cur.execute(
                    """
                    INSERT INTO users (
                        username,
                        password_hash,
                        password_changed_at,
                        password_reset_required,
                        display_name,
                        role,
                        is_super_admin,
                        permissions,
                        status
                    )
                    VALUES (%s, %s, now(), false, %s, 'admin', true, '{}'::jsonb, 'active')
                    """,
                    (username, password_hash, display_name),
                )
                action = "created"
        conn.commit()
    return action


def main() -> None:
    parser = argparse.ArgumentParser(
        description="交互式创建或重置系统超级管理员，不在脚本或命令行中保存密码。"
    )
    parser.add_argument("--username", default="maolab", help="超级管理员用户名")
    parser.add_argument("--display-name", help="显示名称，默认与用户名相同")
    parser.add_argument(
        "--reset-password",
        action="store_true",
        help="明确重置已存在账号的密码，并将其设为启用的超级管理员",
    )
    args = parser.parse_args()

    username = args.username.strip()
    if not username:
        parser.error("用户名不能为空")
    if len(username) > 64:
        parser.error("用户名不能超过 64 位")
    display_name = (args.display_name or username).strip()
    if not display_name:
        parser.error("显示名称不能为空")
    if len(display_name) > 64:
        parser.error("显示名称不能超过 64 位")

    exists = user_exists(username)
    if exists and not args.reset_password:
        print(f"账号 {username} 已存在，未修改密码。需要重置时请明确添加 --reset-password。")
        return

    try:
        password = prompt_password(username)
    except (EOFError, KeyboardInterrupt):
        raise SystemExit("已取消初始化") from None
    except ValueError as exc:
        raise SystemExit(f"初始化失败：{exc}") from None

    action = save_super_admin(
        username=username,
        display_name=display_name,
        password=password,
        reset_password=args.reset_password,
    )
    if action == "created":
        print(f"超级管理员 {username} 已创建。")
    elif action == "reset":
        print(f"超级管理员 {username} 的密码已重置。")
    else:
        print(f"账号 {username} 已存在，未做修改。")


if __name__ == "__main__":
    main()
