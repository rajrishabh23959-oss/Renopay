import json
import random
import uuid
import logging
from typing import Literal

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_current_account
from app.core.money import rupees_to_paise, paise_to_rupees, generate_txn_ref, new_txn_group_id
from app.db.session import get_db
from app.models.user import User
from app.models.account import Account
from app.models.transaction import Transaction, TxnType, TxnStatus, TxnCategory
from app.models.travel import TravelBooking, TravelBookingType, TravelBookingStatus
from app.services.pin_auth import verify_user_pin, PinError
from app.services.pdf_generator import (
    generate_pdf,
    build_travel_ticket_data,
    PDF_AVAILABLE,
)
from app.ws.manager import manager as ws_manager

router = APIRouter()


class BookTravelRequest(BaseModel):
    booking_type: TravelBookingType
    operator_name: str
    service_number: str | None = None
    from_location: str
    to_location: str
    departure_date: str
    departure_time: str | None = None
    arrival_date: str | None = None
    arrival_time: str | None = None
    distance_km: float = 0.0
    travel_class: str
    passenger_name: str
    passenger_age: int | None = None
    passenger_gender: str | None = None
    seat_or_room_no: str | None = None
    amount: float = Field(gt=0, description="Amount in Rupees")
    pin: str | None = None


class TravelBookingOut(BaseModel):
    id: str
    booking_type: str
    pnr_or_ticket_no: str
    operator_name: str
    service_number: str | None
    from_location: str
    to_location: str
    departure_date: str
    departure_time: str | None
    arrival_date: str | None
    arrival_time: str | None
    distance_km: float
    travel_class: str
    passenger_name: str
    seat_or_room_no: str | None
    amount: float
    txn_ref: str
    status: str
    created_at: str

    @classmethod
    def from_model(cls, b: TravelBooking) -> "TravelBookingOut":
        return cls(
            id=str(b.id),
            booking_type=b.booking_type.value if hasattr(b.booking_type, "value") else str(b.booking_type),
            pnr_or_ticket_no=b.pnr_or_ticket_no,
            operator_name=b.operator_name,
            service_number=b.service_number,
            from_location=b.from_location,
            to_location=b.to_location,
            departure_date=b.departure_date,
            departure_time=b.departure_time,
            arrival_date=b.arrival_date,
            arrival_time=b.arrival_time,
            distance_km=b.distance_km,
            travel_class=b.travel_class,
            passenger_name=b.passenger_name,
            seat_or_room_no=b.seat_or_room_no,
            amount=paise_to_rupees(b.amount_paise),
            txn_ref=b.txn_ref,
            status=b.status.value if hasattr(b.status, "value") else str(b.status),
            created_at=b.created_at.isoformat() if b.created_at else "",
        )


@router.post("/book", response_model=TravelBookingOut)
async def book_travel(
    payload: BookTravelRequest,
    user: User = Depends(get_current_user),
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    if user.pin_hash:
        if not payload.pin:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, {"code": "pin_required", "message": "UPI PIN required to book"})
        try:
            await verify_user_pin(db, user, payload.pin)
        except PinError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, {"code": e.code, "message": e.message})

    amount_paise = rupees_to_paise(payload.amount)

    acc_res = await db.execute(select(Account).where(Account.id == account.id).with_for_update())
    locked_acc = acc_res.scalar_one()

    if locked_acc.current_balance_paise < amount_paise:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Insufficient wallet balance to book this ticket")

    # Deduct balance
    locked_acc.current_balance_paise -= amount_paise

    # Generate PNR / Ticket Ref
    prefix = payload.booking_type.value[:3].upper()
    random_digits = random.randint(100000, 999999)
    pnr = f"PNR-{prefix}-{random_digits}"

    # Generate RenoPay Txn
    txn_ref = generate_txn_ref()
    txn = Transaction(
        txn_group_id=new_txn_group_id(),
        txn_ref=txn_ref,
        account_id=locked_acc.id,
        counterparty_vpa=f"{payload.booking_type.value}@renopay",
        counterparty_name=payload.operator_name,
        type=TxnType.DEBIT,
        status=TxnStatus.SUCCESS,
        category=TxnCategory.TRANSPORT,
        amount_paise=amount_paise,
        description=f"{payload.booking_type.value.capitalize()} Booking: {payload.from_location} to {payload.to_location} ({pnr})",
        trust_score=99,
    )
    db.add(txn)
    await db.flush()

    try:
        from app.services import accounting_engine
        await accounting_engine.post_transaction_to_journal(db, txn)
    except Exception as e:
        logger.warning("Accounting journal post note: %s", e)

    # Passenger details serialization
    passenger_info = {
        "name": payload.passenger_name,
        "age": payload.passenger_age,
        "gender": payload.passenger_gender,
        "seat": payload.seat_or_room_no,
    }

    # Tax computation (5% GST standard for transport)
    base_fare_paise = int(amount_paise / 1.05)
    tax_paise = amount_paise - base_fare_paise

    booking = TravelBooking(
        user_id=user.id,
        account_id=locked_acc.id,
        booking_type=payload.booking_type,
        pnr_or_ticket_no=pnr,
        operator_name=payload.operator_name,
        service_number=payload.service_number,
        from_location=payload.from_location,
        to_location=payload.to_location,
        departure_date=payload.departure_date,
        departure_time=payload.departure_time,
        arrival_date=payload.arrival_date or payload.departure_date,
        arrival_time=payload.arrival_time,
        distance_km=payload.distance_km,
        travel_class=payload.travel_class,
        passenger_name=payload.passenger_name,
        passenger_details=json.dumps(passenger_info),
        seat_or_room_no=payload.seat_or_room_no,
        amount_paise=amount_paise,
        base_fare_paise=base_fare_paise,
        tax_paise=tax_paise,
        txn_ref=txn_ref,
        status=TravelBookingStatus.CONFIRMED,
    )
    db.add(booking)
    await db.commit()
    await db.refresh(booking)
    await db.refresh(locked_acc)

    # Push live balance update
    await ws_manager.push(locked_acc.user_id, "balance_update", {
        "balance": paise_to_rupees(locked_acc.current_balance_paise),
        "reason": "travel_booking",
    })

    return TravelBookingOut.from_model(booking)


@router.get("/bookings", response_model=list[TravelBookingOut])
async def get_bookings(
    limit: int = Query(default=30, le=100),
    user: User = Depends(get_current_user),
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TravelBooking)
        .where(TravelBooking.account_id == account.id)
        .order_by(desc(TravelBooking.created_at))
        .limit(limit)
    )
    return [TravelBookingOut.from_model(b) for b in result.scalars().all()]


@router.get("/ticket/{booking_id}/pdf")
async def get_ticket_pdf(
    booking_id: uuid.UUID,
    disposition: Literal["attachment", "inline"] = Query("inline"),
    user: User = Depends(get_current_user),
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TravelBooking).where(
            TravelBooking.id == booking_id,
            TravelBooking.account_id == account.id,
        )
    )
    booking = result.scalar_one_or_none()
    if not booking:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Travel booking not found")

    content_type = "application/pdf" if PDF_AVAILABLE else "text/html"
    filename_ext = "pdf" if PDF_AVAILABLE else "html"

    data = build_travel_ticket_data(booking, user=user)
    buf = await generate_pdf("travel_ticket", data)

    filename = f"Ticket_{booking.pnr_or_ticket_no}.{filename_ext}"
    headers = {
        "Content-Disposition": f'{disposition}; filename="{filename}"',
        "Access-Control-Expose-Headers": "Content-Disposition",
    }
    return StreamingResponse(buf, media_type=content_type, headers=headers)


