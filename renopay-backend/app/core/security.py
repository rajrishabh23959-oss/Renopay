"""
All password/PIN hashing, JWT issuance, and sensitive-field encryption
lives here — one module, so there's a single place to audit for crypto
correctness instead of it being scattered across routers.
"""
import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from cryptography.fernet import Fernet
import jwt
from passlib.context import CryptContext

from app.core.config import settings

import bcrypt

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Fernet key must be a 32-byte urlsafe-base64 string — generate with
# `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key())"`
# and put the result in FIELD_ENCRYPTION_KEY in your .env
_fernet = Fernet(settings.FIELD_ENCRYPTION_KEY.encode()) if len(settings.FIELD_ENCRYPTION_KEY) == 44 else None


# ---------- PIN / password hashing ----------
def hash_pin(pin: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pin.encode("utf-8"), salt).decode("utf-8")


def verify_pin(pin: str, pin_hash: str | None) -> bool:
    if not pin_hash:
        return False
    try:
        return bcrypt.checkpw(pin.encode("utf-8"), pin_hash.encode("utf-8"))
    except Exception:
        try:
            return pwd_context.verify(pin, pin_hash)
        except Exception:
            return False


# ---------- Field-level encryption (Aadhaar ref, etc.) ----------
def encrypt_field(value: str) -> str:
    if _fernet is None:
        raise RuntimeError("FIELD_ENCRYPTION_KEY not configured — generate one, see comment above")
    return _fernet.encrypt(value.encode()).decode()


def decrypt_field(token: str) -> str:
    if _fernet is None:
        raise RuntimeError("FIELD_ENCRYPTION_KEY not configured")
    return _fernet.decrypt(token.encode()).decode()


# ---------- JWT access tokens ----------
def create_access_token(user_id: uuid.UUID) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        "type": "access",
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> uuid.UUID | None:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        if payload.get("type") != "access":
            return None
        return uuid.UUID(payload["sub"])
    except (jwt.PyJWTError, ValueError, KeyError):
        return None


# ---------- Refresh tokens ----------
# Refresh tokens are opaque random strings, not JWTs — we store their
# HASH in the DB (see RefreshToken model) and compare on presentation,
# exactly like we do for PINs. This means a stolen DB dump alone can't
# be used to mint sessions.


def generate_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    token_bytes = hashlib.sha256(token.encode("utf-8")).digest()
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(token_bytes, salt).decode("utf-8")


def hash_refresh_token_lookup(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def verify_refresh_token(token: str, token_hash: str) -> bool:
    try:
        token_bytes = hashlib.sha256(token.encode("utf-8")).digest()
        return bcrypt.checkpw(token_bytes, token_hash.encode("utf-8"))
    except Exception:
        try:
            return pwd_context.verify(token, token_hash)
        except Exception:
            return False


# ---------- OTP HMAC-SHA256 helpers ----------
def hash_otp(code: str) -> str:
    """Computes an HMAC-SHA256 digest of the raw OTP code using JWT_SECRET_KEY."""
    key = settings.JWT_SECRET_KEY.encode("utf-8")
    return hmac.new(key, code.encode("utf-8"), hashlib.sha256).hexdigest()


def verify_otp_hash(provided_code: str, stored_hash: str) -> bool:
    """Performs constant-time verification of raw OTP code against stored HMAC."""
    if not provided_code or not stored_hash:
        return False
    expected_hash = hash_otp(provided_code)
    return hmac.compare_digest(expected_hash, stored_hash)



