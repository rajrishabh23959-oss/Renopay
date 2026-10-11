import logging
import secrets
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from app.api.deps import get_current_user
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.money import generate_virtual_acc_no
from app.core.security import (
    hash_pin, verify_pin, create_access_token, generate_refresh_token,
    hash_refresh_token, verify_refresh_token, encrypt_field, hash_refresh_token_lookup,
    hash_otp, verify_otp_hash
)
from app.core.rate_limit import rate_limit_ip, check_rate_limit
from app.db.session import get_db
from app.models.user import User, KYCStatus, Device
from app.models.account import Account
from app.models.auth import RefreshToken
from app.schemas.auth import (
    RegisterRequest, SetPinRequest,
    LoginRequest, RefreshRequest, TokenResponse,
    SendOtpRequest, SendOtpResponse, VerifyOtpRequest,
    VerifyPinRequest,
)
from app.services.sms import get_sms_provider

logger = logging.getLogger(__name__)

router = APIRouter()


class MockRedis:
    def __init__(self):
        self._data = {}
        self._expiry = {}

    async def setex(self, key, time_secs, value):
        self._data[key] = value
        self._expiry[key] = time.time() + float(time_secs)

    async def getdel(self, key):
        val = await self.get(key)
        await self.delete(key)
        return val

    async def get(self, key):
        if key in self._expiry and time.time() > self._expiry[key]:
            self._data.pop(key, None)
            self._expiry.pop(key, None)
            return None
        return self._data.get(key)

    async def delete(self, *keys):
        for k in keys:
            self._data.pop(k, None)
            self._expiry.pop(k, None)



_redis_mock = MockRedis()
async def _get_redis():
    from app.core.rate_limit import get_redis_client
    r = await get_redis_client()
    return r if r is not None else _redis_mock



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


@router.post("/otp/send", response_model=SendOtpResponse)
async def send_otp_endpoint(
    payload: SendOtpRequest,
    request: Request,
):
    """
    Dispatches a 6-digit verification code to the specified email address.
    Enforces dual rate limits (3/hr per IP and per email) via Redis sliding window.
    Always returns identical success response regardless of account existence.
    """
    email_clean = payload.email.strip().lower()

    # Rate limiting: 3 per hour per email AND per IP
    client_ip = (
        request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or (request.client.host if request.client else "unknown")
    )
    await check_rate_limit(f"otp:ip:{client_ip}", max_requests=settings.OTP_SENDS_PER_HOUR, window_seconds=3600)
    await check_rate_limit(f"otp:email:{email_clean}", max_requests=settings.OTP_SENDS_PER_HOUR, window_seconds=3600)

    # Cryptographically uniform random code using secrets.randbelow
    otp = "".join(str(secrets.randbelow(10)) for _ in range(settings.OTP_LENGTH))

    # Store only HMAC-SHA256(code) in Redis with TTL
    otp_hash = hash_otp(otp)
    redis = await _get_redis()
    otp_key = f"otp:{email_clean}"
    attempts_key = f"otp:attempts:{email_clean}"

    await redis.setex(otp_key, settings.OTP_EXPIRE_SECONDS, otp_hash)
    await redis.setex(attempts_key, settings.OTP_EXPIRE_SECONDS, "0")

    # Send verification email via active provider
    provider = get_sms_provider()
    try:
        await provider.send_otp(email_clean, otp)
    except Exception as exc:
        logger.error("Failed to deliver OTP email: %s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to dispatch verification code. Please check SMTP configuration or try again.",
        )

    # Return generic success response without user enumeration or OTP disclosure
    return SendOtpResponse()


@router.post("/otp/verify", response_model=TokenResponse)
async def verify_otp_endpoint(
    payload: VerifyOtpRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Verifies 6-digit email OTP using constant-time comparison.
    Enforces maximum 5 attempts lockout.
    On success: authenticates existing user or creates new user with starting demo account.
    """
    email_clean = payload.email.strip().lower()
    otp_clean = payload.otp.strip()

    redis = await _get_redis()
    otp_key = f"otp:{email_clean}"
    attempts_key = f"otp:attempts:{email_clean}"

    # Check attempt counter
    raw_attempts = await redis.get(attempts_key)
    attempts = int(raw_attempts or 0)
    if attempts >= settings.OTP_MAX_ATTEMPTS:
        await redis.delete(otp_key, attempts_key)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed verification attempts. Please request a new code.",
        )

    stored_hash = await redis.get(otp_key)
    if not stored_hash:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification code",
        )

    # Constant-time comparison
    if not verify_otp_hash(otp_clean, stored_hash):
        attempts += 1
        if attempts >= settings.OTP_MAX_ATTEMPTS:
            await redis.delete(otp_key, attempts_key)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed verification attempts. Please request a new code.",
            )
        await redis.setex(attempts_key, settings.OTP_EXPIRE_SECONDS, str(attempts))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification code",
        )

    # OTP is valid! Delete on success
    await redis.delete(otp_key, attempts_key)

    # Load or create user
    res = await db.execute(select(User).where(func.lower(User.email) == email_clean))
    user = res.scalar_one_or_none()

    if user is None:
        handle = email_clean.split("@")[0]
        user = User(
            full_name=handle.capitalize(),
            email=email_clean,
            phone_number=None,
            pin_hash=None,
            kyc_status=KYCStatus.VERIFIED,
        )
        db.add(user)
        await db.flush()

        # Create linked Account with starting balance
        vpa_handle = handle.replace(".", "").replace("+", "").replace("-", "")
        base_vpa = f"{vpa_handle}@renopay"
        existing_acc = await db.execute(select(Account).where(Account.vpa == base_vpa))
        if existing_acc.scalar_one_or_none() is not None:
            import random as _rng
            base_vpa = f"{vpa_handle}{_rng.randint(1, 9999)}@renopay"

        account = Account(
            user_id=user.id,
            virtual_acc_no=generate_virtual_acc_no(),
            vpa=base_vpa,
            current_balance_paise=5000000,
        )
        db.add(account)
        await db.commit()
    else:
        # Check if user has linked account
        acc_res = await db.execute(select(Account).where(Account.user_id == user.id))
        account = acc_res.scalar_one_or_none()
        if account is None:
            handle = (user.email or "user").split("@")[0]
            vpa_handle = handle.replace(".", "").replace("+", "").replace("-", "")
            base_vpa = f"{vpa_handle}@renopay"
            account = Account(
                user_id=user.id,
                virtual_acc_no=generate_virtual_acc_no(),
                vpa=base_vpa,
                current_balance_paise=5000000,
            )
            db.add(account)
            await db.commit()

    # Track trusted device if fingerprint provided
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
