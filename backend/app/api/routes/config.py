from fastapi import APIRouter

from app.core.config import settings

router = APIRouter(tags=["config"])


@router.get("/config")
def get_app_config() -> dict:
    return {
        "sequencing_root": settings.sequencing_root,
        "sequencing_nas_root": settings.sequencing_nas_root,
        "sequencing_ssh_enabled": settings.sequencing_ssh_enabled,
        "sequencing_auto_scan_after_import": settings.sequencing_auto_scan_after_import,
    }
