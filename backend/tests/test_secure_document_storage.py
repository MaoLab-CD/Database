from __future__ import annotations

import pytest

from app.core.config import settings
from app.services.secure_document_storage import (
    ENCRYPTED_FILE_MAGIC,
    MAX_PDF_BYTES,
    SecureDocumentDecryptionError,
    decrypt_secure_document,
    encrypt_secure_document,
    validate_pdf_content,
)


SIMPLE_PDF = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF"


def test_secure_document_pdf_limit_is_200_mb() -> None:
    assert MAX_PDF_BYTES == 200 * 1024 * 1024


def test_secure_document_encryption_round_trip_hides_plaintext(monkeypatch) -> None:
    monkeypatch.setattr(settings, "secure_document_encryption_key", "document-test-key")
    encrypted = encrypt_secure_document(SIMPLE_PDF)
    assert encrypted.startswith(ENCRYPTED_FILE_MAGIC)
    assert SIMPLE_PDF not in encrypted
    assert decrypt_secure_document(encrypted) == SIMPLE_PDF


def test_secure_document_tamper_is_rejected(monkeypatch) -> None:
    monkeypatch.setattr(settings, "secure_document_encryption_key", "document-test-key")
    encrypted = bytearray(encrypt_secure_document(SIMPLE_PDF))
    encrypted[-1] ^= 1
    with pytest.raises(SecureDocumentDecryptionError):
        decrypt_secure_document(bytes(encrypted))


@pytest.mark.parametrize(
    "content, message",
    [
        (b"", "PDF 文件为空"),
        (b"not a pdf", "文件内容不是有效 PDF"),
        (SIMPLE_PDF + b"/Encrypt", "暂不支持带打开密码的 PDF"),
        (SIMPLE_PDF + b"/JavaScript", "PDF 含脚本、启动动作或嵌入附件"),
    ],
)
def test_secure_document_pdf_validation_rejects_unsafe_content(content: bytes, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        validate_pdf_content(content)


def test_secure_document_pdf_validation_accepts_regular_pdf() -> None:
    validate_pdf_content(SIMPLE_PDF)
