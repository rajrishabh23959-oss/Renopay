import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import String, Enum, ForeignKey, Boolean, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, UUIDPKMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.account import Account


class KYCStatus(str, enum.Enum):
    PENDING = "pending"
    VERIFIED = "verified"
    REJECTED = "rejected"


class User(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "users"

    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    phone_number: Mapped[str | None] = mapped_column(String(15), unique=True, index=True, nullable=True)
    email: Mapped[str | None] = mapped_column(String(120), index=True, nullable=True)

    # Never store raw PIN — bcrypt hash only
    pin_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    pin_failed_attempts: Mapped[int] = mapped_column(default=0)
    pin_locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    kyc_status: Mapped[KYCStatus] = mapped_column(
        Enum(KYCStatus, name="kyc_status"), default=KYCStatus.PENDING, nullable=False
    )
    # Aadhaar ref is encrypted at rest (see app.core.security.encrypt_field)
    aadhaar_ref_encrypted: Mapped[str | None] = mapped_column(String(512), nullable=True)
    pan_number: Mapped[str | None] = mapped_column(String(10), nullable=True)

    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    language_code: Mapped[str] = mapped_column(String(10), default="en", nullable=False)

    # Last known location — used by SentinAI geo-velocity check
    last_lat: Mapped[float | None] = mapped_column(nullable=True)
    last_lng: Mapped[float | None] = mapped_column(nullable=True)
    last_city: Mapped[str | None] = mapped_column(String(80), nullable=True)
    last_location_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    account: Mapped["Account"] = relationship(back_populates="user", uselist=False)
    devices: Mapped[list["Device"]] = relationship(back_populates="user")


class Device(Base, UUIDPKMixin, TimestampMixin):
    """Trusted-device registry — mirrors mock's `trusted_devices` array,
    but each device gets its own row so we can track trust timestamps,
    revoke individually, and support multi-device SentinAI signals."""
    __tablename__ = "devices"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    device_fingerprint: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    device_label: Mapped[str | None] = mapped_column(String(120), nullable=True)  # e.g. "Chrome on Pixel 8"
    is_trusted: Mapped[bool] = mapped_column(Boolean, default=False)
    trusted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship(back_populates="devices")
