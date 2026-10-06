"""
Shopkeeper and Khatabook Database Models.
Supports:
1. Merchant Voice Box (Soundbox subscription, language preferences, expiry).
2. Khatabook Customers (Customer profiles, phone, UPI, email, outstanding dues).
3. Khatabook Entries (Maine Diye / Maine Liye, itemized notes, dates, payment modes).
"""
import uuid
from datetime import datetime, timezone, date
from sqlalchemy import (
    String, Boolean, BigInteger, Date, DateTime,
    ForeignKey, Text
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.db.base import Base


class MerchantVoiceBox(Base):
    __tablename__ = "merchant_voicebox"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    language: Mapped[str] = mapped_column(String(20), default="hi")  # hi, en, mr, bn, ta, te, bho, gu, kn
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    target_settlement_vpa: Mapped[str] = mapped_column(String(50), default="927922878@renopay")
    auto_announce_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    announce_balance: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User", backref="voicebox")


class KhatabookCustomer(Base):
    __tablename__ = "khatabook_customers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    merchant_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    upi_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    email: Mapped[str | None] = mapped_column(String(120), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    # net_balance_paise: positive means customer owes merchant (Udhar); negative means customer has advance balance
    net_balance_paise: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    entries = relationship("KhatabookEntry", back_populates="customer", cascade="all, delete-orphan", order_by="desc(KhatabookEntry.entry_date)")


class KhatabookEntry(Base):
    __tablename__ = "khatabook_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("khatabook_customers.id", ondelete="CASCADE"))
    merchant_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    entry_type: Mapped[str] = mapped_column(String(10), nullable=False)  # "gave" (Udhar) or "received" (Jama)
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    items_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    entry_date: Mapped[date] = mapped_column(Date, default=date.today)
    payment_mode: Mapped[str] = mapped_column(String(20), default="cash")  # "cash", "renopay_upi", "bank"
    renopay_txn_ref: Mapped[str | None] = mapped_column(String(64), nullable=True)
    voice_transcribed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    customer = relationship("KhatabookCustomer", back_populates="entries")
