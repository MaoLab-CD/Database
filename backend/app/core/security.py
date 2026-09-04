from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

PBKDF2_ITERATIONS = 260_000


def base64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def base64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode((data + padding).encode("ascii"))


def verify_password(password: str, password_hash: str) -> bool:
    try:
        algorithm, iterations_text, salt_text, digest_text = password_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iterations_text)
        salt = base64.urlsafe_b64decode(salt_text.encode("ascii"))
        expected = base64.urlsafe_b64decode(digest_text.encode("ascii"))
    except (TypeError, ValueError):
        return False

    actual = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        iterations,
    )
    return hmac.compare_digest(actual, expected)


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


def private_info_fernet() -> Fernet:
    digest = hashlib.sha256(settings.secret_key.encode("utf-8")).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def decrypt_private_text(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return private_info_fernet().decrypt(value.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return None


def encrypt_private_text(value: str | None) -> str | None:
    if not value:
        return None
    return private_info_fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def create_access_token(
    subject: str,
    extra_claims: dict[str, Any] | None = None,
    expire_minutes: int | None = None,
) -> str:
    now = int(time.time())
    minutes = expire_minutes if expire_minutes is not None else settings.access_token_expire_minutes
    payload: dict[str, Any] = {
        "sub": subject,
        "iat": now,
        "exp": now + minutes * 60,
    }
    if extra_claims:
        payload.update(extra_claims)

    header = {"alg": "HS256", "typ": "JWT"}
    header_part = base64url_encode(
        json.dumps(header, separators=(",", ":")).encode("utf-8")
    )
    payload_part = base64url_encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    )
    signing_input = f"{header_part}.{payload_part}".encode("ascii")
    signature = hmac.new(
        settings.secret_key.encode("utf-8"),
        signing_input,
        hashlib.sha256,
    ).digest()
    return f"{header_part}.{payload_part}.{base64url_encode(signature)}"


def decode_access_token(token: str) -> dict[str, Any] | None:
    try:
        header_part, payload_part, signature_part = token.split(".", 2)
        signing_input = f"{header_part}.{payload_part}".encode("ascii")
        expected_signature = hmac.new(
            settings.secret_key.encode("utf-8"),
            signing_input,
            hashlib.sha256,
        ).digest()
        actual_signature = base64url_decode(signature_part)
        if not hmac.compare_digest(actual_signature, expected_signature):
            return None

        header = json.loads(base64url_decode(header_part))
        if header.get("alg") != "HS256":
            return None

        payload = json.loads(base64url_decode(payload_part))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        return payload
    except (ValueError, TypeError, json.JSONDecodeError):
        return None
