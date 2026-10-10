from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.api.deps import get_current_user, get_current_account
from app.core.money import rupees_to_paise, paise_to_rupees, generate_txn_ref
from app.db.session import get_db
from app.models.user import User
from app.models.account import Account
from app.models.transaction import Transaction, TxnCategory, TxnType, TxnStatus
from app.schemas.payment import (
    ResolveVPAResponse, SendMoneyRequest, SendMoneyResponse, TransactionOut, AddMoneyRequest,
)
from app.services import payment_engine
from app.services.payment_engine import PaymentError
from app.services.upi_directory import identify_upi_provider, format_name_from_vpa
from app.ws.manager import manager as ws_manager

router = APIRouter()


@router.get("/resolve/{vpa}", response_model=ResolveVPAResponse)
async def resolve_vpa(
    vpa: str,
    pn: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    clean_vpa = vpa.strip()
    clean_vpa_lower = clean_vpa.lower()

    # 1. If internal RenoPay handle, look up user from database
    if clean_vpa_lower.endswith("@renopay"):
        try:
            if clean_vpa_lower in ("rishabhraj@renopay", "rishab@renopay", "rishabraj@renopay"):
                result = await db.execute(
                    select(Account, User).join(User, Account.user_id == User.id).where(
                        (Account.vpa.in_(["rishabhraj@renopay", "rishab@renopay"])) | (User.phone_number == "9876543210")
                    )
                )
            else:
                result = await db.execute(select(Account, User).join(User, Account.user_id == User.id).where(Account.vpa == clean_vpa_lower))
            row = result.first()
            if row is not None:
                _, user = row
                return ResolveVPAResponse(vpa=clean_vpa, name=user.full_name, app="RenoPay", bank="RenoPay Virtual Bank")
            if clean_vpa_lower in ("rishabhraj@renopay", "rishab@renopay", "rishabraj@renopay"):
                return ResolveVPAResponse(vpa=clean_vpa, name="Rishabh Raj", app="RenoPay", bank="RenoPay Virtual Bank")
        except Exception:
            pass

    # 2. External UPI handle validation (Paytm, PhonePe, Google Pay, YESPay/Flipkart, BharatPe, BHIM, Banks, etc.)
    if "@" in clean_vpa_lower:
        parts = clean_vpa_lower.split("@")
        if len(parts) == 2 and parts[0] and parts[1]:
            info = identify_upi_provider(clean_vpa_lower)
            display_name = pn.strip() if (pn and pn.strip()) else format_name_from_vpa(clean_vpa)
            return ResolveVPAResponse(
                vpa=clean_vpa,
                name=display_name,
                app=info["app_name"],
                bank=info["bank_name"],
            )

    raise HTTPException(status.HTTP_404_NOT_FOUND, "VPA not found")


from app.core.rate_limit import rate_limit_ip


@router.post("/send", response_model=SendMoneyResponse, dependencies=[Depends(rate_limit_ip(max_requests=30, window_seconds=60))])
async def send_money(
    payload: SendMoneyRequest,
    user: User = Depends(get_current_user),
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    amount_paise = rupees_to_paise(payload.amount)

    try:
        result = await payment_engine.send_money(
            db, sender_user_id=user.id, receiver_vpa=payload.to_vpa, amount_paise=amount_paise,
            pin=payload.pin,
            description=payload.description, category=TxnCategory(payload.category),
            device_fingerprint=payload.device_fingerprint,
            current_lat=payload.current_lat, current_lng=payload.current_lng,
            note_slide_ms=payload.note_slide_ms, note_count=payload.note_count,
            device_tilt_deg=payload.device_tilt_deg,
            use_upi_lite=payload.use_upi_lite,
            idempotency_key=payload.idempotency_key,
            receiver_name=payload.receiver_name,
        )
    except PaymentError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, {"code": e.code, "message": e.message})

    return SendMoneyResponse(
        success=True, txn_ref=result.txn_ref, amount=paise_to_rupees(result.amount_paise),
        round_up=paise_to_rupees(result.round_up_paise),
        new_balance=paise_to_rupees(result.sender_new_balance_paise),
        trust_score=result.trust_score, risk_level=result.risk_level,
    )


@router.post("/add-money")
async def add_money(
    payload: AddMoneyRequest,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    if not settings.DEBUG:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    """Simulates a bank-gateway top-up (Razorpay-style). Real integration
    would verify a webhook signature here before crediting — kept as a
    direct credit for demo purposes, clearly marked for that swap."""
    amount_paise = rupees_to_paise(payload.amount)
    if amount_paise > 100000:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Max add money limit is ₹1000")
    orig_bal = account.current_balance_paise
    account.current_balance_paise += amount_paise
    from app.services.denomination_service import add_denominations
    account.cash_denominations = add_denominations(account.cash_denominations, int(payload.amount), orig_bal)
    txn = Transaction(
        txn_group_id=payment_engine.new_txn_group_id(),
        txn_ref=generate_txn_ref(), account_id=account.id,
        counterparty_vpa="gateway@razorpay", type=TxnType.CREDIT, status=TxnStatus.SUCCESS,
        category=TxnCategory.INCOME, amount_paise=amount_paise,
        description=f"Added via {payload.bank_name}", trust_score=99,
    )
    db.add(txn)
    await db.flush()
    from app.services import accounting_engine
    await accounting_engine.post_transaction_to_journal(db, txn)
    await db.commit()
    await db.refresh(account)
    await ws_manager.push(account.user_id, "balance_update", {
        "balance": paise_to_rupees(account.current_balance_paise),
        "denominations": account.cash_denominations,
        "reason": "add_money",
    })
    return {"success": True, "new_balance": paise_to_rupees(account.current_balance_paise)}


@router.get("/transactions", response_model=list[TransactionOut])
async def get_transactions(
    limit: int = Query(default=50, le=200), offset: int = 0,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Transaction)
        .where(Transaction.account_id == account.id)
        .order_by(desc(Transaction.created_at))
        .limit(limit).offset(offset)
    )
    return [TransactionOut.from_model(t) for t in result.scalars().all()]
