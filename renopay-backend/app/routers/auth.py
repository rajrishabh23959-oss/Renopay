from datetime import datetime, timedelta, timezone


from fastapi import APIRouter, Depends, HTTPException, status
from app.api.deps import get_current_user
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.money import generate_virtual_acc_no
from app.core.security import (
    hash_pin, verify_pin, create_access_token, generate_refresh_token,
    hash_refresh_token, verify_refresh_token, encrypt_field, hash_refresh_token_lookup
)
from app.db.session import get_db
from app.models.user import User, KYCStatus, Device
from app.models.account import Account
from app.models.auth import RefreshToken
from app.schemas.auth import (
    RegisterRequest, SetPinRequest,
    LoginRequest, RefreshRequest, TokenResponse,
)

router = APIRouter()

class MockRedis:
    def __init__(self):
        self._data = {}

    async def setex(self, key, time, value):
        self._data[key] = value

    async def getdel(self, key):
        return self._data.pop(key, None)

    async def get(self, key):
        return self._data.get(key)

from app.core.rate_limit import rate_limit_ip


_redis_mock = MockRedis()
async def _get_redis():
    return _redis_mock



@router.post("/register", response_model=TokenResponse, dependencies=[Depends(rate_limit_ip(max_requests=10, window_seconds=60))])
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.phone_number == payload.phone_number))
    user = existing.scalar_one_or_none()
    if user is not None:
        # If user is already registered, directly log in and return tokens
        return await _issue_tokens(db, user.id, None)

    user = User(
        full_name=payload.full_name,
        phone_number=payload.phone_number,
        email=payload.email,
        pan_number=payload.pan_number,
        pin_hash=None,
        kyc_status=KYCStatus.VERIFIED,
    )
    if payload.aadhaar_number:
        user.aadhaar_ref_encrypted = encrypt_field(payload.aadhaar_number)
    db.add(user)
    await db.flush()

    vpa_handle = payload.full_name.lower().replace(" ", "")
    base_vpa = f"{vpa_handle}@renopay"
    existing_acc = await db.execute(select(Account).where(Account.vpa == base_vpa))
    if existing_acc.scalar_one_or_none() is not None:
        import random as _rng
        base_vpa = f"{vpa_handle}{_rng.randint(1, 9999)}@renopay"

    account = Account(
        user_id=user.id,
        virtual_acc_no=generate_virtual_acc_no(),
        vpa=base_vpa,
        current_balance_paise=5000000,  # ₹50,000 demo starting balance
    )
    db.add(account)
    await db.commit()

    return await _issue_tokens(db, user.id, None)


@router.patch("/pin", response_model=TokenResponse)
async def set_pin(payload: SetPinRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    user.pin_hash = hash_pin(payload.pin)
    await db.commit()
    return await _issue_tokens(db, user.id, None)


from pydantic import BaseModel

class VerifyPinRequest(BaseModel):
    pin: str

@router.post("/verify-pin", dependencies=[Depends(rate_limit_ip(max_requests=15, window_seconds=60))])
async def verify_pin_endpoint(
    payload: VerifyPinRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services.pin_auth import verify_user_pin, PinError
    try:
        await verify_user_pin(db, user, payload.pin)
        await db.commit()
        return {"success": True, "message": "UPI PIN verified successfully"}
    except PinError as exc:
        status_code = status.HTTP_401_UNAUTHORIZED if exc.code == "invalid_pin" else status.HTTP_400_BAD_REQUEST
        if exc.code == "pin_locked":
            status_code = status.HTTP_423_LOCKED
        raise HTTPException(status_code, exc.message)


def _ensure_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


@router.post("/login", response_model=TokenResponse, dependencies=[Depends(rate_limit_ip(max_requests=15, window_seconds=60))])
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.phone_number == payload.phone_number))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No account found with this phone number")

    if user.pin_locked_until and _ensure_utc(user.pin_locked_until) > datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_423_LOCKED, "Account temporarily locked — too many failed PIN attempts")

    # If user has configured a PIN and a PIN was supplied, verify it
    if user.pin_hash and payload.pin:
        if not verify_pin(payload.pin, user.pin_hash):
            user.pin_failed_attempts += 1
            if user.pin_failed_attempts >= settings.MAX_PIN_ATTEMPTS:
                user.pin_locked_until = datetime.now(timezone.utc) + timedelta(minutes=settings.PIN_LOCKOUT_MINUTES)
            await db.commit()
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid PIN")

    user.pin_failed_attempts = 0
    user.pin_locked_until = None

    if payload.device_fingerprint:
        dev_result = await db.execute(
            select(Device).where(
                Device.user_id == user.id, Device.device_fingerprint == payload.device_fingerprint
            )
        )
        device = dev_result.scalar_one_or_none()
        if device is None:
            db.add(Device(
                user_id=user.id,
                device_fingerprint=payload.device_fingerprint,
                device_label=payload.device_label,
            ))
        else:
            device.last_seen_at = datetime.now(timezone.utc)

    await db.commit()
    return await _issue_tokens(db, user.id, payload.device_fingerprint)


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token_endpoint(payload: RefreshRequest, db: AsyncSession = Depends(get_db)):
    lookup_hash = hash_refresh_token_lookup(payload.refresh_token)
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.token_lookup_hash == lookup_hash,
        )
    )
    matched = result.scalar_one_or_none()
    
    if matched is None or not verify_refresh_token(payload.refresh_token, matched.token_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")
        
    if matched.revoked:
        # Token Family Revocation: If a revoked token is used, assume compromise and revoke ALL tokens
        await db.execute(
            RefreshToken.__table__.update()
            .where(RefreshToken.user_id == matched.user_id)
            .values(revoked=True)
        )
        await db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token reused. All sessions revoked.")
        
    if _ensure_utc(matched.expires_at) <= datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Expired refresh token")

    # Rotate: revoke old, issue new
    matched.revoked = True
    await db.commit()
    return await _issue_tokens(db, matched.user_id, matched.device_fingerprint)


@router.post("/logout")
async def logout(payload: RefreshRequest, db: AsyncSession = Depends(get_db)):
    lookup_hash = hash_refresh_token_lookup(payload.refresh_token)
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.token_lookup_hash == lookup_hash,
            RefreshToken.revoked is False,
        )
    )
    rt = result.scalar_one_or_none()
    if rt and verify_refresh_token(payload.refresh_token, rt.token_hash):
        rt.revoked = True
        await db.commit()
    return {"success": True}


async def _issue_tokens(db: AsyncSession, user_id, device_fingerprint: str | None) -> TokenResponse:
    access = create_access_token(user_id)
    raw_refresh = generate_refresh_token()
    db.add(RefreshToken(
        user_id=user_id,
        token_hash=hash_refresh_token(raw_refresh),
        token_lookup_hash=hash_refresh_token_lookup(raw_refresh),
        device_fingerprint=device_fingerprint,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    ))
    await db.commit()
    return TokenResponse(access_token=access, refresh_token=raw_refresh, user_id=user_id)
