from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.routers import auth, accounts, payments, requests as requests_router
from app.routers import mandates, rewards, goals, vaults, lite, analytics, ws
from app.routers import gold, voice, ledger, accounting, ai, travel, financial_services, gift_cards
from app.routers import voicebox, khatabook
from app.services.scheduler import start_scheduler


_db_initialized = False


from app.core.logging import logger
import uuid
from fastapi.responses import JSONResponse
import traceback

@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        from app.db.session import init_db_if_needed
        await init_db_if_needed()
    except Exception as e:
        logger.warning("Warning during database initialization: %s", e)

    import os
    scheduler = None
    if not os.environ.get("VERCEL"):
        try:
            scheduler = start_scheduler()
        except Exception as e:
            logger.warning("Warning starting scheduler: %s", e)
    yield
    if scheduler:
        scheduler.shutdown()


app = FastAPI(
    title=settings.APP_NAME,
    version="0.2.0",
    description="RenoPay backend — Production fintech API.",
    lifespan=lifespan,
)

# SEC-01: Enforce explicit CORS allowlist without wildcard regex
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# SEC-08: Request body size limit (5MB) & Security Headers Middleware
@app.middleware("http")
async def security_and_size_middleware(request, call_next):
    # Enforce request body size limit
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > 5 * 1024 * 1024:
        return JSONResponse(
            status_code=413,
            content={"detail": "Payload too large. Request body exceeds 5MB limit."},
        )

    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
    return response


@app.middleware("http")
async def handle_api_prefix(request, call_next):
    if request.scope["path"].startswith("/api/"):
        request.scope["path"] = request.scope["path"][4:]
    elif request.scope["path"] == "/api":
        request.scope["path"] = "/"
    return await call_next(request)


# SEC-02: Sanitize global exception handler, assign request-id, prevent DB error leaks
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    from fastapi import HTTPException
    if isinstance(exc, HTTPException):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    request_id = str(uuid.uuid4())
    tb = traceback.format_exc()
    logger.error("Unhandled exception [request_id=%s] on %s: %s", request_id, request.url.path, tb)

    # Return safe generic response to clients — details logged server-side only
    return JSONResponse(
        status_code=500,
        content={
            "detail": "An internal server error occurred. Please contact support with the request ID.",
            "request_id": request_id,
        },
    )



app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(accounts.router, prefix="/accounts", tags=["accounts"])
app.include_router(payments.router, prefix="/payments", tags=["payments"])
app.include_router(requests_router.router, prefix="/requests", tags=["requests"])
app.include_router(mandates.router, prefix="/mandates", tags=["mandates"])
app.include_router(rewards.router, prefix="/rewards", tags=["rewards"])
app.include_router(goals.router, prefix="/goals", tags=["goals"])
app.include_router(vaults.router, prefix="/vaults", tags=["vaults"])
app.include_router(lite.router, prefix="/lite", tags=["upi-lite"])
app.include_router(analytics.router, prefix="/analytics", tags=["analytics"])
app.include_router(ws.router, tags=["websocket"])  # exposes /ws
app.include_router(gold.router, prefix="/gold", tags=["digital-gold"])
app.include_router(voice.router, prefix="/payments", tags=["voice-upi"])
app.include_router(ledger.router, prefix="/analytics", tags=["reports"])
app.include_router(accounting.router, prefix="/accounting", tags=["accounting"])
app.include_router(ai.router, prefix="/ai", tags=["ai-assistant"])
app.include_router(travel.router, prefix="/travel", tags=["travel"])
app.include_router(financial_services.router, prefix="/financial", tags=["financial-services"])
app.include_router(gift_cards.router, prefix="/gift-cards", tags=["gift-cards"])
app.include_router(voicebox.router, prefix="/voicebox", tags=["voicebox"])
app.include_router(khatabook.router, prefix="/khatabook", tags=["khatabook"])


@app.patch("/user/preferences", tags=["user-preferences"])
async def user_preferences_alias(
    payload: accounts.UserPreferencesUpdate,
    user=accounts.Depends(accounts.get_current_user),
    account=accounts.Depends(accounts.get_current_account),
    db=accounts.Depends(accounts.get_db),
):
    return await accounts.update_preferences(payload, user, account, db)


@app.post("/user/profile-photo", tags=["user-profile"])
async def user_upload_photo_alias(
    file: accounts.UploadFile = accounts.File(...),
    user=accounts.Depends(accounts.get_current_user),
    account=accounts.Depends(accounts.get_current_account),
    db=accounts.Depends(accounts.get_db),
):
    return await accounts.upload_profile_photo(file, user, account, db)


@app.delete("/user/profile-photo", tags=["user-profile"])
async def user_delete_photo_alias(
    user=accounts.Depends(accounts.get_current_user),
    account=accounts.Depends(accounts.get_current_account),
    db=accounts.Depends(accounts.get_db),
):
    return await accounts.delete_profile_photo(user, account, db)



@app.get("/health")
async def health():
    db_status = "unconfigured"
    db_err = None
    if settings.DATABASE_URL:
        try:
            from app.db.session import engine
            from sqlalchemy import text
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            db_status = "connected"
        except Exception as e:
            db_status = "error"
            db_err = str(e)
    else:
        db_status = "missing_DATABASE_URL"

    if db_status == "error":
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "version": "1.0.0",
                "database": db_status,
                "database_error": db_err,
            },
        )

    return {
        "status": "ok",
        "version": "1.0.0",
        "database": db_status,
    }
