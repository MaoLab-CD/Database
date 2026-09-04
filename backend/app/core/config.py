from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    app_name: str = "sample-admin"
    app_env: str = "development"
    secret_key: str = "change-me"
    hospital_upload_encryption_key: str | None = None
    secure_document_encryption_key: str | None = None
    access_token_expire_minutes: int = 480
    trusted_proxy_cidrs: list[str] = [
        "127.0.0.0/8",
        "::1/128",
        "172.16.0.0/12",
    ]
    database_url: str = (
        "postgresql+psycopg://sample_admin_dev:sample_admin_dev@localhost:5433/sample_admin"
    )
    backup_dir: str = "/opt/sample-admin/backups/postgres"
    secure_document_root: str = "/app/uploads/secure_documents"
    sequencing_root: str = "/data/sequencing"
    sequencing_nas_root: str | None = None
    cors_origins: list[str] = ["http://127.0.0.1:5173", "http://localhost:5173"]
    sequencing_ssh_enabled: bool = True
    sequencing_auto_scan_after_import: bool = False

    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
