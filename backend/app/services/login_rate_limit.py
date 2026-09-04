from __future__ import annotations

import hashlib
import ipaddress
from datetime import datetime

from fastapi import Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings


ACCOUNT_MAX_FAILED_ATTEMPTS = 5
IP_MAX_FAILED_ATTEMPTS = 30
ATTEMPT_WINDOW_MINUTES = 15
LOCK_MINUTES = 15


def normalize_username(value: str) -> str:
    return value.strip().casefold()


def client_ip_from_request(request: Request) -> str | None:
    peer_ip = _valid_ip(request.client.host if request.client else None)
    if peer_ip is None:
        return None

    if not _is_trusted_proxy(peer_ip):
        return peer_ip

    candidates: list[str] = []
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        candidates.append(real_ip.strip())
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        # Nginx overwrites this header with its directly observed client address.
        # Reading the right-most value remains safe if another trusted proxy is
        # deliberately added in front of Nginx later.
        candidates.extend(
            part.strip() for part in reversed(forwarded_for.split(","))
        )

    for candidate in candidates:
        parsed = _valid_ip(candidate)
        if parsed is not None:
            return parsed
    return peer_ip


def _valid_ip(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        return None


def _is_trusted_proxy(value: str) -> bool:
    address = ipaddress.ip_address(value)
    for cidr in settings.trusted_proxy_cidrs:
        try:
            if address in ipaddress.ip_network(cidr, strict=False):
                return True
        except ValueError:
            continue
    return False


def login_identifiers(username: str, request: Request) -> list[tuple[str, str]]:
    identifiers = [("account", normalize_username(username))]
    client_ip = client_ip_from_request(request)
    if client_ip:
        identifiers.append(("ip", client_ip))
    return identifiers


def identifier_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def cleanup_stale_limits(db: Session) -> None:
    db.execute(
        text(
            """
            DELETE FROM auth_login_rate_limits
            WHERE updated_at < now() - interval '7 days'
              AND (locked_until IS NULL OR locked_until <= now())
            """
        )
    )


def locked_until_for(
    db: Session,
    identifiers: list[tuple[str, str]],
) -> datetime | None:
    locked_until: datetime | None = None
    for identifier_type, value in identifiers:
        candidate = db.execute(
            text(
                """
                SELECT locked_until
                FROM auth_login_rate_limits
                WHERE identifier_type = :identifier_type
                  AND identifier_hash = :identifier_hash
                  AND locked_until > now()
                """
            ),
            {
                "identifier_type": identifier_type,
                "identifier_hash": identifier_hash(value),
            },
        ).scalar_one_or_none()
        if candidate is not None and (locked_until is None or candidate > locked_until):
            locked_until = candidate
    return locked_until


def record_login_failure(
    db: Session,
    identifiers: list[tuple[str, str]],
) -> datetime | None:
    latest_lock: datetime | None = None
    for identifier_type, value in identifiers:
        max_failed_attempts = (
            ACCOUNT_MAX_FAILED_ATTEMPTS
            if identifier_type == "account"
            else IP_MAX_FAILED_ATTEMPTS
        )
        row = (
            db.execute(
                text(
                    f"""
                    INSERT INTO auth_login_rate_limits (
                        identifier_type,
                        identifier_hash,
                        failed_attempts,
                        window_started_at,
                        locked_until,
                        last_failed_at
                    )
                    VALUES (
                        :identifier_type,
                        :identifier_hash,
                        1,
                        now(),
                        NULL,
                        now()
                    )
                    ON CONFLICT (identifier_type, identifier_hash) DO UPDATE
                    SET failed_attempts = CASE
                            WHEN auth_login_rate_limits.window_started_at
                                 <= now() - interval '{ATTEMPT_WINDOW_MINUTES} minutes'
                              OR auth_login_rate_limits.locked_until <= now()
                            THEN 1
                            ELSE auth_login_rate_limits.failed_attempts + 1
                        END,
                        window_started_at = CASE
                            WHEN auth_login_rate_limits.window_started_at
                                 <= now() - interval '{ATTEMPT_WINDOW_MINUTES} minutes'
                              OR auth_login_rate_limits.locked_until <= now()
                            THEN now()
                            ELSE auth_login_rate_limits.window_started_at
                        END,
                        locked_until = CASE
                            WHEN auth_login_rate_limits.window_started_at
                                 <= now() - interval '{ATTEMPT_WINDOW_MINUTES} minutes'
                              OR auth_login_rate_limits.locked_until <= now()
                            THEN NULL
                            WHEN auth_login_rate_limits.failed_attempts + 1 >= {max_failed_attempts}
                            THEN now() + interval '{LOCK_MINUTES} minutes'
                            ELSE NULL
                        END,
                        last_failed_at = now(),
                        updated_at = now()
                    RETURNING failed_attempts, locked_until
                    """
                ),
                {
                    "identifier_type": identifier_type,
                    "identifier_hash": identifier_hash(value),
                },
            )
            .mappings()
            .one()
        )
        candidate = row["locked_until"]
        if candidate is not None and (latest_lock is None or candidate > latest_lock):
            latest_lock = candidate
    return latest_lock


def clear_login_failures(
    db: Session,
    identifiers: list[tuple[str, str]],
) -> None:
    for identifier_type, value in identifiers:
        db.execute(
            text(
                """
                DELETE FROM auth_login_rate_limits
                WHERE identifier_type = :identifier_type
                  AND identifier_hash = :identifier_hash
                """
            ),
            {
                "identifier_type": identifier_type,
                "identifier_hash": identifier_hash(value),
            },
        )
