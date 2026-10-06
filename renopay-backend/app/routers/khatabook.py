"""
RenoPay Digital Khatabook Router.
Provides:
1. Customer Onboarding & Management (Name, Phone, UPI ID, Email, Address, Net Balance).
2. Udhar & Jama Ledger Entries (Maine Diye / Maine Liye, Itemized Notes, Dates, Payment Modes).
3. 1-Tap RenoPay UPI Money Request & Auto-Reconciliation.
4. Saathi AI Voice-Assisted Entry (bolkar khata entry parsing).
5. Customer Statement PDF (Itemized date-wise history).
6. Full Month Business Sales PDF (Weekly & daily analytics).
"""
import uuid
import re
from datetime import datetime, timezone, timedelta, date
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, func, desc, or_, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.models.account import Account
from app.models.shopkeeper import KhatabookCustomer, KhatabookEntry
from app.models.money_request import MoneyRequest, RequestStatus
from app.services.khatabook_pdf import render_khatabook_pdf

router = APIRouter()

_khatabook_columns_checked = False

async def _ensure_khatabook_columns(db: AsyncSession):
    global _khatabook_columns_checked
    if _khatabook_columns_checked:
        return
    ddls = [
        "ALTER TABLE khatabook_customers ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();",
        "ALTER TABLE khatabook_customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();",
        "ALTER TABLE khatabook_customers ALTER COLUMN created_at SET DEFAULT NOW();",
        "ALTER TABLE khatabook_customers ALTER COLUMN updated_at SET DEFAULT NOW();",
        "ALTER TABLE khatabook_customers ALTER COLUMN created_at DROP NOT NULL;",
        "ALTER TABLE khatabook_customers ALTER COLUMN updated_at DROP NOT NULL;",
        "ALTER TABLE khatabook_customers ADD COLUMN IF NOT EXISTS upi_id VARCHAR(80);",
        "ALTER TABLE khatabook_customers ADD COLUMN IF NOT EXISTS email VARCHAR(120);",
        "ALTER TABLE khatabook_customers ADD COLUMN IF NOT EXISTS address TEXT;",
        "ALTER TABLE khatabook_customers ADD COLUMN IF NOT EXISTS net_balance_paise BIGINT DEFAULT 0;",
        "ALTER TABLE khatabook_entries ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();",
        "ALTER TABLE khatabook_entries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();",
        "ALTER TABLE khatabook_entries ALTER COLUMN created_at SET DEFAULT NOW();",
        "ALTER TABLE khatabook_entries ALTER COLUMN updated_at SET DEFAULT NOW();",
        "ALTER TABLE khatabook_entries ALTER COLUMN created_at DROP NOT NULL;",
        "ALTER TABLE khatabook_entries ALTER COLUMN updated_at DROP NOT NULL;",
        "ALTER TABLE khatabook_entries ADD COLUMN IF NOT EXISTS items_description TEXT;",
        "ALTER TABLE khatabook_entries ADD COLUMN IF NOT EXISTS entry_date DATE DEFAULT CURRENT_DATE;",
        "ALTER TABLE khatabook_entries ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(20) DEFAULT 'cash';",
        "ALTER TABLE khatabook_entries ADD COLUMN IF NOT EXISTS renopay_txn_ref VARCHAR(64);",
        "ALTER TABLE khatabook_entries ADD COLUMN IF NOT EXISTS voice_transcribed BOOLEAN DEFAULT FALSE;",
    ]
    for ddl in ddls:
        try:
            await db.execute(text(ddl))
            await db.commit()
        except Exception:
            await db.rollback()
    _khatabook_columns_checked = True


# ── Schemas ───────────────────────────────────────────────────────────────────

class CreateCustomerRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=10, max_length=15)
    upi_id: str | None = None
    email: str | None = None
    address: str | None = None


class CreateEntryRequest(BaseModel):
    entry_type: str = Field(description="'gave' (Maine Diye / Udhar) or 'received' (Maine Liye / Jama)")
    amount: float = Field(gt=0, description="Amount in Rupees")
    items_description: str | None = Field(default=None, description="Purchased items or bill notes")
    entry_date: date | None = None
    payment_mode: str = Field(default="cash", description="'cash', 'renopay_upi', or 'bank'")


class RequestPaymentRequest(BaseModel):
    amount: float | None = Field(default=None, description="Custom amount or full balance if None")
    note: str | None = "RenoPay Khatabook Payment Request"


class VoiceParseRequest(BaseModel):
    transcript: str = Field(min_length=2, description="Spoken speech in Hindi, English, or regional language")
    auto_save: bool = False


# ── Customer Endpoints ────────────────────────────────────────────────────────

@router.get("/summary")
async def get_khatabook_summary(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Overall dashboard counters for the shopkeeper."""
    await _ensure_khatabook_columns(db)
    cust_res = await db.execute(
        select(KhatabookCustomer).where(KhatabookCustomer.merchant_user_id == user.id)
    )
    customers = cust_res.scalars().all()

    total_you_will_get_paise = sum(c.net_balance_paise for c in customers if c.net_balance_paise > 0)
    total_you_will_give_paise = sum(abs(c.net_balance_paise) for c in customers if c.net_balance_paise < 0)

    # Monthly Sales calculations
    today = date.today()
    first_of_month = date(today.year, today.month, 1)

    entries_res = await db.execute(
        select(KhatabookEntry).where(
            KhatabookEntry.merchant_user_id == user.id,
            KhatabookEntry.entry_date >= first_of_month,
        )
    )
    month_entries = entries_res.scalars().all()

    month_gave_paise = sum(e.amount_paise for e in month_entries if e.entry_type == "gave")
    month_received_paise = sum(e.amount_paise for e in month_entries if e.entry_type == "received")

    return {
        "total_customers": len(customers),
        "total_you_will_get": total_you_will_get_paise / 100,
        "total_you_will_give": total_you_will_give_paise / 100,
        "monthly_sales": month_gave_paise / 100,
        "monthly_collections": month_received_paise / 100,
        "month_label": today.strftime("%B %Y"),
    }


@router.get("/customers")
async def list_customers(
    search: str | None = None,
    filter_type: str | None = Query(None, description="all | due | advance"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List shopkeeper's customers with net balances and latest entry date."""
    await _ensure_khatabook_columns(db)
    query = select(KhatabookCustomer).where(KhatabookCustomer.merchant_user_id == user.id)

    if search and search.strip():
        term = f"%{search.strip().lower()}%"
        query = query.where(
            or_(
                func.lower(KhatabookCustomer.name).like(term),
                KhatabookCustomer.phone.like(term),
            )
        )

    if filter_type == "due":
        query = query.where(KhatabookCustomer.net_balance_paise > 0)
    elif filter_type == "advance":
        query = query.where(KhatabookCustomer.net_balance_paise < 0)

    query = query.order_by(desc(KhatabookCustomer.updated_at))
    res = await db.execute(query)
    customers = res.scalars().all()

    items = []
    for c in customers:
        items.append({
            "id": str(c.id),
            "name": c.name,
            "phone": c.phone,
            "upi_id": c.upi_id or f"{c.phone}@upi",
            "email": c.email,
            "address": c.address,
            "net_balance": c.net_balance_paise / 100,
            "is_due": c.net_balance_paise > 0,
            "created_at": c.created_at.isoformat(),
            "updated_at": c.updated_at.isoformat(),
        })

    return {"customers": items, "count": len(items)}


@router.post("/customers")
async def create_customer(
    payload: CreateCustomerRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Onboard a new customer to merchant's Khatabook."""
    await _ensure_khatabook_columns(db)
    clean_phone = re.sub(r"\D", "", payload.phone)
    if len(clean_phone) < 10:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Phone number must be at least 10 digits")

    # Check duplicate for this merchant
    existing_res = await db.execute(
        select(KhatabookCustomer).where(
            KhatabookCustomer.merchant_user_id == user.id,
            KhatabookCustomer.phone == clean_phone,
        )
    )
    if existing_res.scalar_one_or_none():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Customer with this phone number already exists in your Khata.")

    now = datetime.now(timezone.utc)
    customer = KhatabookCustomer(
        merchant_user_id=user.id,
        name=payload.name.strip(),
        phone=clean_phone,
        upi_id=payload.upi_id.strip() if payload.upi_id else f"{clean_phone}@upi",
        email=payload.email.strip() if payload.email else None,
        address=payload.address.strip() if payload.address else None,
        net_balance_paise=0,
        created_at=now,
        updated_at=now,
    )
    db.add(customer)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        await _ensure_khatabook_columns(db)
        raw_cust = """
            INSERT INTO khatabook_customers (
                id, merchant_user_id, name, phone, upi_id, email, address,
                net_balance_paise, created_at, updated_at
            ) VALUES (
                :id, :uid, :name, :phone, :upi_id, :email, :address,
                0, :now, :now
            )
            ON CONFLICT (id) DO NOTHING;
        """
        await db.execute(
            text(raw_cust),
            {
                "id": customer.id,
                "uid": user.id,
                "name": customer.name,
                "phone": customer.phone,
                "upi_id": customer.upi_id,
                "email": customer.email,
                "address": customer.address,
                "now": now,
            }
        )
        await db.commit()

    try:
        await db.refresh(customer)
    except Exception:
        pass

    return {
        "success": True,
        "customer": {
            "id": str(customer.id),
            "name": customer.name,
            "phone": customer.phone,
            "upi_id": customer.upi_id,
            "net_balance": 0.0,
        },
    }


@router.get("/customers/{customer_id}")
async def get_customer_details(
    customer_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Fetch customer profile and itemized transaction history."""
    res = await db.execute(
        select(KhatabookCustomer)
        .options(selectinload(KhatabookCustomer.entries))
        .where(
            KhatabookCustomer.id == customer_id,
            KhatabookCustomer.merchant_user_id == user.id,
        )
    )
    customer = res.scalar_one_or_none()
    if not customer:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")

    entries_out = []
    total_gave = 0
    total_received = 0

    for e in customer.entries:
        if e.entry_type == "gave":
            total_gave += e.amount_paise
        else:
            total_received += e.amount_paise

        entries_out.append({
            "id": str(e.id),
            "entry_type": e.entry_type,
            "amount": e.amount_paise / 100,
            "items_description": e.items_description,
            "entry_date": e.entry_date.isoformat(),
            "payment_mode": e.payment_mode,
            "renopay_txn_ref": e.renopay_txn_ref,
            "voice_transcribed": e.voice_transcribed,
            "created_at": e.created_at.isoformat(),
        })

    return {
        "customer": {
            "id": str(customer.id),
            "name": customer.name,
            "phone": customer.phone,
            "upi_id": customer.upi_id,
            "email": customer.email,
            "address": customer.address,
            "net_balance": customer.net_balance_paise / 100,
            "total_gave": total_gave / 100,
            "total_received": total_received / 100,
        },
        "entries": entries_out,
    }


@router.post("/customers/{customer_id}/entries")
async def add_ledger_entry(
    customer_id: uuid.UUID,
    payload: CreateEntryRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Record Udhar (gave) or Jama (received) entry with itemized description.
    Automatically updates the customer's net balance.
    """
    res = await db.execute(
        select(KhatabookCustomer).where(
            KhatabookCustomer.id == customer_id,
            KhatabookCustomer.merchant_user_id == user.id,
        )
    )
    customer = res.scalar_one_or_none()
    if not customer:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")

    entry_type = payload.entry_type.strip().lower()
    if entry_type not in ("gave", "received"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "entry_type must be 'gave' or 'received'")

    amount_paise = int(round(payload.amount * 100))
    now = datetime.now(timezone.utc)
    entry = KhatabookEntry(
        customer_id=customer.id,
        merchant_user_id=user.id,
        entry_type=entry_type,
        amount_paise=amount_paise,
        items_description=payload.items_description.strip() if payload.items_description else None,
        entry_date=entry_date,
        payment_mode=payload.payment_mode.lower(),
        created_at=now,
        updated_at=now,
    )
    db.add(entry)

    # Update net balance:
    # 'gave' increases what customer owes merchant
    # 'received' decreases what customer owes merchant
    if entry_type == "gave":
        customer.net_balance_paise += amount_paise
    else:
        customer.net_balance_paise -= amount_paise

    customer.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(entry)

    return {
        "success": True,
        "entry": {
            "id": str(entry.id),
            "entry_type": entry.entry_type,
            "amount": entry.amount_paise / 100,
            "items_description": entry.items_description,
            "entry_date": entry.entry_date.isoformat(),
        },
        "new_net_balance": customer.net_balance_paise / 100,
    }


@router.post("/customers/{customer_id}/request-pay")
async def request_customer_payment(
    customer_id: uuid.UUID,
    payload: RequestPaymentRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    1-Tap Payment Request: Sends a direct RenoPay UPI Collect Request to customer.
    When paid by customer, it automatically reconciles and deducts from customer's Khata!
    """
    res = await db.execute(
        select(KhatabookCustomer).where(
            KhatabookCustomer.id == customer_id,
            KhatabookCustomer.merchant_user_id == user.id,
        )
    )
    customer = res.scalar_one_or_none()
    if not customer:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")

    amount = payload.amount or (customer.net_balance_paise / 100)
    if amount <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Payment request amount must be greater than 0")

    # Fetch merchant account
    m_res = await db.execute(select(Account).where(Account.user_id == user.id))
    merchant_account = m_res.scalar_one_or_none()
    if not merchant_account:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Merchant account not found")

    # Check if customer has a RenoPay account registered with their phone
    cust_acc_res = await db.execute(
        select(Account).join(User, Account.user_id == User.id).where(User.phone_number == customer.phone)
    )
    target_account = cust_acc_res.scalar_one_or_none()

    payer_vpa = target_account.vpa if target_account else (customer.upi_id or f"{customer.phone}@upi")

    money_req = MoneyRequest(
        requester_account_id=merchant_account.id,
        payer_vpa=payer_vpa,
        payer_phone=customer.phone,
        payer_name=customer.name,
        amount_paise=int(round(amount * 100)),
        note=f"RenoPay Khata Bill: {payload.note or 'Udhar hisab settlement'}",
        status=RequestStatus.PENDING,
    )
    db.add(money_req)
    await db.commit()

    return {
        "success": True,
        "message": f"Payment request for ₹{amount:.2f} sent successfully to {customer.name} ({payer_vpa})!",
        "request_id": str(money_req.id),
        "amount": amount,
        "payer_vpa": payer_vpa,
    }


# ── Saathi AI Voice-Assisted Entry Parser ─────────────────────────────────────

@router.post("/voice-parse")
async def parse_voice_entry(
    payload: VoiceParseRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Parses Hindi/English natural language speech from the mic:
    e.g. "Aaj Ramesh ko 200 rupaye diye 2 kilo chawal ke liye"
    or "rishabh se 500 rupaye jama mile"
    """
    text = payload.transcript.strip()
    lower = text.lower()

    # 1. Determine Intent (gave vs received)
    entry_type = "gave"  # default
    received_keywords = ["liye", "liya", "mile", "mila", "jama", "prapt", "aaye", "aaya", "received", "got"]
    gave_keywords = ["diye", "diya", "udhar", "gave", "de diya"]

    if any(k in lower for k in received_keywords):
        entry_type = "received"
    elif any(k in lower for k in gave_keywords):
        entry_type = "gave"

    # 2. Extract Amount
    amount = 0.0
    amt_match = re.search(r"(?:rs|₹|rupaye|rupayee|rupeye|rupya|taka)?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:rs|₹|rupaye|rupayee|rupeye|rupya|taka)?", lower)
    if amt_match:
        try:
            amount = float(amt_match.group(1))
        except Exception:
            pass

    # 3. Extract Customer Name
    # Try pattern like: "([A-Za-z\u0900-\u097F]+)\s+(?:ko|se|ne)"
    extracted_name = ""
    name_match = re.search(r"(?:aaj\s+)?([A-Za-z\u0900-\u097F]+)\s+(?:ko|se|ne)", text, re.IGNORECASE)
    if name_match:
        extracted_name = name_match.group(1).capitalize()
    else:
        # Fallback first word
        words = text.split()
        if len(words) > 1 and words[0].lower() not in ["aaj", "kal", "maine", "mujhe"]:
            extracted_name = words[0].capitalize()

    # Match with existing customers
    all_cust_res = await db.execute(
        select(KhatabookCustomer).where(KhatabookCustomer.merchant_user_id == user.id)
    )
    customers = all_cust_res.scalars().all()

    matched_customer = None
    if extracted_name:
        for c in customers:
            if extracted_name.lower() in c.name.lower() or c.name.lower() in extracted_name.lower():
                matched_customer = c
                break

    # 4. Extract Items Description
    items_desc = ""
    desc_match = re.search(r"(?:ke liye|ka|par|saman)\s+(.*)", text, re.IGNORECASE)
    if desc_match:
        items_desc = desc_match.group(1).strip()
    elif "diye" in lower:
        parts = re.split(r"diye|diya", text, flags=re.IGNORECASE)
        if len(parts) > 1 and parts[1].strip():
            items_desc = parts[1].strip()

    if not items_desc:
        items_desc = "Voice note entry"

    # If auto_save requested and matched customer exists and amount > 0:
    saved_entry = None
    if payload.auto_save and matched_customer and amount > 0:
        amount_paise = int(round(amount * 100))
        now = datetime.now(timezone.utc)
        entry = KhatabookEntry(
            customer_id=matched_customer.id,
            merchant_user_id=user.id,
            entry_type=entry_type,
            amount_paise=amount_paise,
            items_description=items_desc,
            entry_date=date.today(),
            payment_mode="cash" if entry_type == "gave" else "renopay_upi",
            voice_transcribed=True,
            created_at=now,
            updated_at=now,
        )
        db.add(entry)
        if entry_type == "gave":
            matched_customer.net_balance_paise += amount_paise
        else:
            matched_customer.net_balance_paise -= amount_paise
        await db.commit()
        saved_entry = {"id": str(entry.id), "amount": amount, "entry_type": entry_type}

    return {
        "success": True,
        "transcript": text,
        "parsed": {
            "entry_type": entry_type,
            "entry_type_label": "Maine Diye (Udhar)" if entry_type == "gave" else "Maine Liye (Jama)",
            "amount": amount,
            "customer_name": matched_customer.name if matched_customer else extracted_name,
            "items_description": items_desc,
        },
        "matched_customer": {
            "id": str(matched_customer.id),
            "name": matched_customer.name,
            "phone": matched_customer.phone,
            "net_balance": matched_customer.net_balance_paise / 100,
        } if matched_customer else None,
        "saved_entry": saved_entry,
    }


# ── PDF Generation Endpoints ──────────────────────────────────────────────────

@router.get("/customers/{customer_id}/pdf")
async def download_customer_statement_pdf(
    customer_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generates and streams customer monthly itemized PDF report."""
    res = await db.execute(
        select(KhatabookCustomer)
        .options(selectinload(KhatabookCustomer.entries))
        .where(
            KhatabookCustomer.id == customer_id,
            KhatabookCustomer.merchant_user_id == user.id,
        )
    )
    customer = res.scalar_one_or_none()
    if not customer:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")

    acc_res = await db.execute(select(Account).where(Account.user_id == user.id))
    m_acc = acc_res.scalar_one_or_none()

    total_gave = sum(e.amount_paise for e in customer.entries if e.entry_type == "gave")
    total_received = sum(e.amount_paise for e in customer.entries if e.entry_type == "received")

    entries_data = []
    for e in customer.entries:
        entries_data.append({
            "entry_date": e.entry_date.strftime("%d %b %Y"),
            "items_description": e.items_description,
            "payment_mode": e.payment_mode,
            "entry_type": e.entry_type,
            "amount_fmt": f"{e.amount_paise / 100:,.2f}",
            "renopay_txn_ref": e.renopay_txn_ref,
        })

    pdf_context = {
        "merchant_name": user.full_name or "RenoPay Merchant",
        "merchant_vpa": m_acc.vpa if m_acc else f"{user.phone_number}@renopay",
        "generated_at": datetime.now(timezone.utc).strftime("%d %b %Y, %I:%M %p"),
        "customer": {
            "name": customer.name,
            "phone": customer.phone,
            "upi_id": customer.upi_id,
        },
        "total_gave_fmt": f"{total_gave / 100:,.2f}",
        "total_received_fmt": f"{total_received / 100:,.2f}",
        "net_balance": customer.net_balance_paise / 100,
        "net_balance_fmt": f"{abs(customer.net_balance_paise) / 100:,.2f}",
        "entries": entries_data,
    }

    try:
        pdf_stream = await render_khatabook_pdf("customer_statement", pdf_context)
    except Exception as e:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"PDF Generation Error: {str(e)}")

    filename = f"Khata_Statement_{customer.name.replace(' ', '_')}_{date.today()}.pdf"
    return StreamingResponse(
        pdf_stream,
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename={filename}"},
    )


@router.get("/reports/monthly-sales-pdf")
async def download_monthly_sales_pdf(
    month: int | None = None,
    year: int | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generates and streams full month sales & business breakdown PDF."""
    today = date.today()
    target_month = month or today.month
    target_year = year or today.year

    start_date = date(target_year, target_month, 1)
    if target_month == 12:
        end_date = date(target_year + 1, 1, 1) - timedelta(days=1)
    else:
        end_date = date(target_year, target_month + 1, 1) - timedelta(days=1)

    acc_res = await db.execute(select(Account).where(Account.user_id == user.id))
    m_acc = acc_res.scalar_one_or_none()

    # Query entries in this month
    entries_res = await db.execute(
        select(KhatabookEntry).where(
            KhatabookEntry.merchant_user_id == user.id,
            KhatabookEntry.entry_date >= start_date,
            KhatabookEntry.entry_date <= end_date,
        )
    )
    entries = entries_res.scalars().all()

    total_sales = sum(e.amount_paise for e in entries if e.entry_type == "gave")
    total_recovered = sum(e.amount_paise for e in entries if e.entry_type == "received")

    upi_collected = sum(e.amount_paise for e in entries if e.entry_type == "received" and e.payment_mode == "renopay_upi")
    cash_collected = sum(e.amount_paise for e in entries if e.entry_type == "received" and e.payment_mode != "renopay_upi")

    # Weekly breakdown
    weekly = []
    for w in range(1, 5):
        w_start = start_date + timedelta(days=(w - 1) * 7)
        w_end = min(end_date, w_start + timedelta(days=6))
        w_entries = [e for e in entries if w_start <= e.entry_date <= w_end]
        w_sales = sum(e.amount_paise for e in w_entries if e.entry_type == "gave")
        w_rec = sum(e.amount_paise for e in w_entries if e.entry_type == "received")
        net = w_rec - w_sales
        weekly.append({
            "week_name": f"Week {w}",
            "dates": f"{w_start.strftime('%d %b')} – {w_end.strftime('%d %b')}",
            "sales_fmt": f"{w_sales / 100:,.2f}",
            "collections_fmt": f"{w_rec / 100:,.2f}",
            "net": net / 100,
            "net_fmt": f"{abs(net) / 100:,.2f}",
        })

    # Customers with top pending dues
    cust_res = await db.execute(
        select(KhatabookCustomer)
        .where(
            KhatabookCustomer.merchant_user_id == user.id,
            KhatabookCustomer.net_balance_paise > 0,
        )
        .order_by(desc(KhatabookCustomer.net_balance_paise))
        .limit(5)
    )
    debtors = cust_res.scalars().all()

    top_debtors = [
        {
            "name": d.name,
            "phone": d.phone,
            "balance_fmt": f"{d.net_balance_paise / 100:,.2f}",
        }
        for d in debtors
    ]

    tot_collected = (upi_collected + cash_collected) or 1
    upi_pct = int(round((upi_collected / tot_collected) * 100))
    cash_pct = 100 - upi_pct

    pdf_context = {
        "merchant_name": user.full_name or "RenoPay Merchant",
        "merchant_vpa": m_acc.vpa if m_acc else f"{user.phone_number}@renopay",
        "month_label": start_date.strftime("%B %Y"),
        "generated_at": datetime.now(timezone.utc).strftime("%d %b %Y, %I:%M %p"),
        "total_sales_fmt": f"{total_sales / 100:,.2f}",
        "total_udhar_given_fmt": f"{total_sales / 100:,.2f}",
        "total_udhar_recovered_fmt": f"{total_recovered / 100:,.2f}",
        "total_outstanding_fmt": f"{max(0, total_sales - total_recovered) / 100:,.2f}",
        "weekly_breakdown": weekly,
        "upi_collected_fmt": f"{upi_collected / 100:,.2f}",
        "cash_collected_fmt": f"{cash_collected / 100:,.2f}",
        "upi_pct": upi_pct,
        "cash_pct": cash_pct,
        "top_debtors": top_debtors,
    }

    try:
        pdf_stream = await render_khatabook_pdf("monthly_sales", pdf_context)
    except Exception as e:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"PDF Generation Error: {str(e)}")

    filename = f"RenoPay_Monthly_Sales_{start_date.strftime('%B_%Y')}.pdf"
    return StreamingResponse(
        pdf_stream,
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename={filename}"},
    )
