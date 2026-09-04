from starlette.requests import Request

from app.services.login_rate_limit import (
    ACCOUNT_MAX_FAILED_ATTEMPTS,
    IP_MAX_FAILED_ATTEMPTS,
    client_ip_from_request,
    identifier_hash,
    login_identifiers,
    normalize_username,
)


def build_request(
    *,
    forwarded_for: str | None = None,
    real_ip: str | None = None,
    client_ip: str = "172.18.0.2",
) -> Request:
    headers: list[tuple[bytes, bytes]] = []
    if forwarded_for:
        headers.append((b"x-forwarded-for", forwarded_for.encode("ascii")))
    if real_ip:
        headers.append((b"x-real-ip", real_ip.encode("ascii")))
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/auth/login",
            "headers": headers,
            "client": (client_ip, 12345),
        }
    )


def test_client_ip_prefers_real_ip_from_trusted_proxy() -> None:
    request = build_request(
        forwarded_for="invalid, 203.0.113.7, 10.0.0.2",
        real_ip="203.0.113.8",
    )

    assert client_ip_from_request(request) == "203.0.113.8"


def test_client_ip_uses_rightmost_forwarded_address_from_trusted_proxy() -> None:
    request = build_request(forwarded_for="198.51.100.9, 203.0.113.7")

    assert client_ip_from_request(request) == "203.0.113.7"


def test_client_ip_ignores_forwarded_headers_from_untrusted_peer() -> None:
    request = build_request(
        forwarded_for="203.0.113.7",
        real_ip="203.0.113.8",
        client_ip="198.51.100.20",
    )

    assert client_ip_from_request(request) == "198.51.100.20"


def test_login_identifiers_normalize_account_and_include_ip() -> None:
    request = build_request(forwarded_for="2001:db8::5")

    assert normalize_username("  MaoLab  ") == "maolab"
    assert login_identifiers("  MaoLab  ", request) == [
        ("account", "maolab"),
        ("ip", "2001:db8::5"),
    ]


def test_identifier_hash_does_not_store_plain_identifier() -> None:
    value = "maolab"
    hashed = identifier_hash(value)

    assert hashed != value
    assert len(hashed) == 64
    assert hashed == identifier_hash(value)


def test_account_threshold_is_stricter_than_shared_ip_threshold() -> None:
    assert ACCOUNT_MAX_FAILED_ATTEMPTS == 5
    assert IP_MAX_FAILED_ATTEMPTS == 30
