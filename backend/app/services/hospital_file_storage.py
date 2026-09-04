from __future__ import annotations

import base64
import hashlib
import hmac
import os
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Iterator

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


ENCRYPTED_FILE_SUFFIX = ".enc"
ENCRYPTED_FILE_MAGIC = b"SAMPLE-ADMIN-HOSPITAL-UPLOAD-V1\n"
KEY_DERIVATION_CONTEXT = b"sample-admin/hospital-upload-file/v1"


class HospitalFileDecryptionError(ValueError):
    pass


def _primary_encryption_secret() -> bytes:
    value = settings.hospital_upload_encryption_key or settings.secret_key
    return value.encode("utf-8")


def hospital_upload_fernet(secret: bytes | None = None) -> Fernet:
    # Domain separation prevents the file-encryption key from being identical
    # to the key used for JWT signatures or encrypted database fields.
    digest = hmac.new(
        secret or _primary_encryption_secret(),
        KEY_DERIVATION_CONTEXT,
        hashlib.sha256,
    ).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def encrypt_hospital_file(content: bytes) -> bytes:
    return ENCRYPTED_FILE_MAGIC + hospital_upload_fernet().encrypt(content)


def decrypt_hospital_file(content: bytes) -> tuple[bytes, bool]:
    """Return plaintext and whether the stored payload used encrypted V1 format."""
    if not content.startswith(ENCRYPTED_FILE_MAGIC):
        return content, False
    token = content[len(ENCRYPTED_FILE_MAGIC):]
    candidate_secrets = [_primary_encryption_secret()]
    # Compatibility for files encrypted during development before the
    # dedicated key was configured. New files always use the dedicated key
    # when present, while old SECRET_KEY-derived files remain readable.
    secret_key = settings.secret_key.encode("utf-8")
    if secret_key not in candidate_secrets:
        candidate_secrets.append(secret_key)
    for secret in candidate_secrets:
        try:
            return hospital_upload_fernet(secret).decrypt(token), True
        except InvalidToken:
            continue
    raise HospitalFileDecryptionError("encrypted hospital upload cannot be decrypted")


def write_encrypted_hospital_file(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary_path.write_bytes(encrypt_hospital_file(content))
        try:
            temporary_path.chmod(0o600)
        except OSError:
            pass
        temporary_path.replace(path)
    finally:
        temporary_path.unlink(missing_ok=True)


def read_hospital_file(path: Path) -> tuple[bytes, bool]:
    return decrypt_hospital_file(path.read_bytes())


def plaintext_suffix_for_stored_path(path: Path) -> str:
    if path.suffix.lower() == ENCRYPTED_FILE_SUFFIX:
        suffix = Path(path.stem).suffix.lower()
    else:
        suffix = path.suffix.lower()
    return suffix if suffix in {".xls", ".xlsx", ".xlsm", ".csv"} else ".bin"


@contextmanager
def temporary_plaintext_file(content: bytes, suffix: str) -> Iterator[Path]:
    with TemporaryDirectory(prefix="sample-admin-hospital-upload-") as directory:
        directory_path = Path(directory)
        try:
            directory_path.chmod(0o700)
        except OSError:
            pass
        path = directory_path / f"upload{suffix}"
        path.write_bytes(content)
        try:
            path.chmod(0o600)
        except OSError:
            pass
        yield path
