from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import (
    audit,
    auth,
    batch_codes,
    centers,
    config,
    dashboard,
    documents,
    freezers,
    health,
    hospital_uploads,
    imports,
    plates,
    records,
    returns,
    samples,
    sequencing,
    specimen_types,
    users,
)
from app.core.config import settings
from app.api.deps import require_internal_user


app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
internal_only = [Depends(require_internal_user)]

app.include_router(config.router, prefix="/api", dependencies=internal_only)
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(batch_codes.router, prefix="/api/batch-codes", tags=["batch-codes"], dependencies=internal_only)
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"], dependencies=internal_only)
app.include_router(documents.router, prefix="/api/documents", tags=["documents"], dependencies=internal_only)
app.include_router(freezers.router, prefix="/api/freezers", tags=["freezers"], dependencies=internal_only)
app.include_router(specimen_types.router, prefix="/api/specimen-types", tags=["specimen-types"], dependencies=internal_only)
app.include_router(samples.router, prefix="/api/samples", tags=["samples"], dependencies=internal_only)
app.include_router(sequencing.router, prefix="/api/sequencing", tags=["sequencing"], dependencies=internal_only)
app.include_router(returns.router, prefix="/api/returns", tags=["returns"], dependencies=internal_only)
app.include_router(records.router, prefix="/api/records", tags=["records"], dependencies=internal_only)
app.include_router(users.router, prefix="/api/users", tags=["users"], dependencies=internal_only)
app.include_router(audit.router, prefix="/api/audit", tags=["audit"], dependencies=internal_only)
app.include_router(imports.router, prefix="/api/imports", tags=["imports"], dependencies=internal_only)
app.include_router(hospital_uploads.router, prefix="/api/hospital-uploads", tags=["hospital-uploads"])
app.include_router(plates.router, prefix="/api/plates", tags=["plates"], dependencies=internal_only)
app.include_router(centers.router, prefix="/api/centers", tags=["centers"], dependencies=internal_only)
