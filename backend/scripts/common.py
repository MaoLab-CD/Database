'''
Author: 袁瑞 && 2502099390@qq.com
Date: 2026-06-12 13:39:11
LastEditors: 袁瑞 && 2502099390@qq.com
LastEditTime: 2026-06-12 15:01:21
FilePath: \sample_admin\backend\scripts\common.py
Description: 
'''
from __future__ import annotations

import base64
import hashlib
import os
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet


BACKEND_DIR = Path(__file__).resolve().parents[1]


def load_env() -> dict[str, str]:
    env_path = BACKEND_DIR / ".env"
    values: dict[str, str] = {}
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    essential_keys = {"DATABASE_URL", "SECRET_KEY", "SEQUENCING_ROOT", "BACKUP_DIR"}
    for key in essential_keys:
        if os.environ.get(key):
            values[key] = os.environ[key]
    values.update({k: v for k, v in os.environ.items() if k in values or k.startswith("APP_")})
    return values


def database_url() -> str:
    env = load_env()
    url = env.get(
        "DATABASE_URL",
        "postgresql+psycopg://root:<password>@localhost:5432/sample_admin",
    )
    return url.replace("postgresql+psycopg://", "postgresql://", 1)


def sequencing_root() -> str:
    return load_env().get("SEQUENCING_ROOT", "/data/sequencing")


def secret_key() -> str:
    return load_env().get("SECRET_KEY", "change-me")


def normalize_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text


def sha256_text(value: str | None) -> str | None:
    if not value:
        return None
    return hashlib.sha256(value.strip().encode("utf-8")).hexdigest()


def encrypt_text(value: str | None) -> str | None:
    if not value:
        return None
    digest = hashlib.sha256(secret_key().encode("utf-8")).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key).encrypt(value.encode("utf-8")).decode("utf-8")
