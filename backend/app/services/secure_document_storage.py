from __future__ import annotations

import base64
import hashlib
import hmac
import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


ENCRYPTED_FILE_MAGIC = b"SAMPLE-ADMIN-SECURE-DOCUMENT-V1\n"
ENCRYPTED_FILE_SUFFIX = ".pdf.enc"
KEY_DERIVATION_CONTEXT = b"sample-admin/secure-document-file/v1"
MAX_PDF_BYTES = 200 * 1024 * 1024
PDF_DANGEROUS_MARKERS = (
    b"/JavaScript",
    b"/JS ",
    b"/Launch",
    b"/EmbeddedFile",
)


class SecureDocumentDecryptionError(ValueError):
    pass


def _primary_encryption_secret() -> bytes:
    value = settings.secure_document_encryption_key or settings.secret_key
    return value.encode("utf-8")


def secure_document_fernet(secret: bytes | None = None) -> Fernet:
    digest = hmac.new(
        secret or _primary_encryption_secret(),
        KEY_DERIVATION_CONTEXT,
        hashlib.sha256,
    ).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def validate_pdf_content(content: bytes) -> None:
    if not content:
        raise ValueError("PDF 文件为空")
    if len(content) > MAX_PDF_BYTES:
        raise ValueError("PDF 文件不能超过 200 MB")
    if b"%PDF-" not in content[:1024]:
        raise ValueError("文件内容不是有效 PDF")
    if b"/Encrypt" in content:
        raise ValueError("暂不支持带打开密码的 PDF")
    if any(marker in content for marker in PDF_DANGEROUS_MARKERS):
        raise ValueError("PDF 含脚本、启动动作或嵌入附件，已阻止上传")


def encrypt_secure_document(content: bytes) -> bytes:
    return ENCRYPTED_FILE_MAGIC + secure_document_fernet().encrypt(content)


def decrypt_secure_document(content: bytes) -> bytes:
    if not content.startswith(ENCRYPTED_FILE_MAGIC):
        raise SecureDocumentDecryptionError("资料文件不是受支持的加密格式")
    token = content[len(ENCRYPTED_FILE_MAGIC):]
    candidate_secrets = [_primary_encryption_secret()]
    secret_key = settings.secret_key.encode("utf-8")
    if secret_key not in candidate_secrets:
        candidate_secrets.append(secret_key)
    for secret in candidate_secrets:
        try:
            return secure_document_fernet(secret).decrypt(token)
        except InvalidToken:
            continue
    raise SecureDocumentDecryptionError("资料文件解密失败，请检查加密密钥")


def write_encrypted_document(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary_path.write_bytes(encrypt_secure_document(content))
        try:
            temporary_path.chmod(0o600)
        except OSError:
            pass
        temporary_path.replace(path)
    finally:
        temporary_path.unlink(missing_ok=True)


def read_encrypted_document(path: Path) -> bytes:
    return decrypt_secure_document(path.read_bytes())


def document_root() -> Path:
    return Path(settings.secure_document_root).resolve()


def resolve_document_path(relative_path: str) -> Path:
    root = document_root()
    resolved = (root / relative_path).resolve()
    if resolved != root and root not in resolved.parents:
        raise ValueError("资料文件路径异常")
    return resolved
