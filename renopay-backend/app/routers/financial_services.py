import random
import uuid
import logging
from datetime import datetime
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
from app.models.financial import Loan, Investment, BillPayment
from app.services.pin_auth import verify_user_pin, PinError
from app.services.pdf_generator import (
    generate_pdf,
    build_receipt_data,
    PDF_AVAILABLE,
)
from app.ws.manager import manager as ws_manager

router = APIRouter()


# --------------------------------------------------------------------------
# SCHEMAS
# --------------------------------------------------------------------------
class BillPayRequest(BaseModel):
    bill_type: str = Field(description="mobile_recharge, electricity_bill, tuition_fee, utility")
    operator: str
    consumer_number: str
    recipient_name: str | None = None
    plan_details: str | None = None
    amount: float = Field(gt=0, description="Amount in Rupees")
    pin: str | None = None


class BillPayResponse(BaseModel):
    success: bool
    txn_ref: str
    amount: float
    new_balance: float
    bill_id: str
    operator: str
    consumer_number: str
    created_at: str
    status: str


class ApplyLoanRequest(BaseModel):
    loan_type: str = "Personal Loan"
    lender: str = "HDFC Bank & RenoPay Credit"
    principal: float = Field(gt=0, description="Principal amount in Rupees")
    tenure_months: int = Field(ge=1, le=60)
    interest_rate: float = 11.5
    monthly_emi: float = Field(gt=0)
    pin: str | None = None


class RepayLoanRequest(BaseModel):
    loan_code: str
    amount: float = Field(gt=0)
    pin: str | None = None


class LoanOut(BaseModel):
    id: str
    loan_code: str
    type: str
    lender: str
    principal: float
    remainingAmount: float
    monthlyEmi: float
    tenureMonths: int
    emisPaid: int
    interestRate: float
    nextDueDate: str
    disbursedAt: str
    status: str
    disbursalTxnRef: str | None


class InvestRequest(BaseModel):
    investment_type: str = "sip"  # "sip", "daily_sip", "daily_rd"
    fund_name: str
    category: str = "Equity Growth"
    amount: float = Field(gt=0)
    tenure_months: int | None = 6
    interest_rate: float | None = 8.1
    pin: str | None = None


class InvestmentOut(BaseModel):
    id: str
    investment_code: str
    type: str
    fund_name: str
    category: str
    monthly_amount: float
    invested_amount: float
    current_value: float
    next_debit_date: str
    status: str
    txn_ref: str | None


# --------------------------------------------------------------------------
# 1. BILL PAYMENTS & MOBILE RECHARGE
# --------------------------------------------------------------------------
@router.post("/bills/pay", response_model=BillPayResponse)
async def pay_bill(
    payload: BillPayRequest,
    user: User = Depends(get_current_user),
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    if user.pin_hash:
        if not payload.pin:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, {"code": "pin_required", "message": "UPI PIN required for payment"})
        try:
            await verify_user_pin(db, user, payload.pin)
        except PinError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, {"code": e.code, "message": e.message})

    amount_paise = rupees_to_paise(payload.amount)

    acc_res = await db.execute(select(Account).where(Account.id == account.id).with_for_update())
    locked_acc = acc_res.scalar_one()

    if locked_acc.current_balance_paise < amount_paise:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Insufficient wallet balance (Available: Rs {paise_to_rupees(locked_acc.current_balance_paise):.2f})",
        )

    # Deduct balance
    locked_acc.current_balance_paise -= amount_paise

    # Target VPA
    clean_operator = payload.operator.strip().lower().replace(" ", "")
    if "@" in payload.consumer_number:
        counterparty_vpa = payload.consumer_number.strip()
    else:
        counterparty_vpa = f"{clean_operator}@bbps"

    # Category mapping
    if "tuition" in payload.bill_type.lower() or "education" in payload.bill_type.lower():
        cat = TxnCategory.EDUCATION
    else:
        cat = TxnCategory.BILLS

    txn_ref = generate_txn_ref()
    desc_text = f"{payload.bill_type.replace('_', ' ').title()}: {payload.operator} ({payload.consumer_number})"
    if payload.recipient_name:
        desc_text += f" - {payload.recipient_name}"

    txn = Transaction(
        txn_group_id=new_txn_group_id(),
        txn_ref=txn_ref,
        account_id=locked_acc.id,
        counterparty_vpa=counterparty_vpa,
        counterparty_name=payload.operator,
        type=TxnType.DEBIT,
        status=TxnStatus.SUCCESS,
        category=cat,
        amount_paise=amount_paise,
        description=desc_text,
        trust_score=99,
    )
    db.add(txn)
    await db.flush()

    try:
        from app.services import accounting_engine
        await accounting_engine.post_transaction_to_journal(db, txn)
    except Exception as e:
        logger.warning("Accounting journal post note: %s", e)

    bill_record = BillPayment(
        user_id=user.id,
        account_id=locked_acc.id,
        bill_type=payload.bill_type,
        operator=payload.operator,
        consumer_number=payload.consumer_number,
        recipient_name=payload.recipient_name,
        plan_details=payload.plan_details,
        amount_paise=amount_paise,
        txn_ref=txn_ref,
        status="SUCCESS",
    )
    db.add(bill_record)
    await db.commit()
    await db.refresh(locked_acc)

    # Push live balance update
    await ws_manager.push(locked_acc.user_id, "balance_update", {
        "balance": paise_to_rupees(locked_acc.current_balance_paise),
        "reason": payload.bill_type,
    })

    return BillPayResponse(
        success=True,
        txn_ref=txn_ref,
        amount=payload.amount,
        new_balance=paise_to_rupees(locked_acc.current_balance_paise),
        bill_id=str(bill_record.id),
        operator=payload.operator,
        consumer_number=payload.consumer_number,
        created_at=datetime.now().isoformat(),
        status="SUCCESS",
    )


# --------------------------------------------------------------------------
# 2. LOANS (APPLY & REPAY)
# --------------------------------------------------------------------------
@router.post("/loans/apply", response_model=LoanOut)
async def apply_loan(
    payload: ApplyLoanRequest,
    user: User = Depends(get_current_user),
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    if user.pin_hash and payload.pin:
        try:
            await verify_user_pin(db, user, payload.pin)
        except PinError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, {"code": e.code, "message": e.message})

    principal_paise = rupees_to_paise(payload.principal)
    emi_paise = rupees_to_paise(payload.monthly_emi)

    acc_res = await db.execute(select(Account).where(Account.id == account.id).with_for_update())
    locked_acc = acc_res.scalar_one()

    # Credit loan amount directly to user's wallet!
    locked_acc.current_balance_paise += principal_paise

    loan_code = f"LOAN-{payload.loan_type[:4].upper()}-{random.randint(1000, 9999)}"
    txn_ref = generate_txn_ref()

    # Ledger transaction for disbursal (Credit)
    txn = Transaction(
        txn_group_id=new_txn_group_id(),
        txn_ref=txn_ref,
        account_id=locked_acc.id,
        counterparty_vpa="loans@renopay",
        counterparty_name=payload.lender,
        type=TxnType.CREDIT,
        status=TxnStatus.SUCCESS,
        category=TxnCategory.INCOME,
        amount_paise=principal_paise,
        description=f"Loan Approved & Disbursed: {payload.loan_type} ({loan_code})",
        trust_score=99,
    )
    db.add(txn)
    await db.flush()

    try:
        from app.services import accounting_engine
        await accounting_engine.post_transaction_to_journal(db, txn)
    except Exception as e:
        logger.warning("Accounting journal post note: %s", e)

    now = datetime.now()
    d = datetime(now.year, now.month, now.day)
    if d.month == 12:
        next_due = datetime(d.year + 1, 1, min(d.day, 28)).strftime("%Y-%m-%d")
    else:
        next_due = datetime(d.year, d.month + 1, min(d.day, 28)).strftime("%Y-%m-%d")

    loan = Loan(
        user_id=user.id,
        account_id=locked_acc.id,
        loan_code=loan_code,
        loan_type=payload.loan_type,
        lender=payload.lender,
        principal_paise=principal_paise,
        remaining_amount_paise=principal_paise,
        monthly_emi_paise=emi_paise,
        tenure_months=payload.tenure_months,
        emis_paid=0,
        interest_rate=payload.interest_rate,
        next_due_date=next_due,
        disbursed_at=now.strftime("%Y-%m-%d"),
        status="ACTIVE",
        disbursal_txn_ref=txn_ref,
    )
    db.add(loan)
    await db.commit()
    await db.refresh(loan)
    await db.refresh(locked_acc)

    # Push live balance update
    await ws_manager.push(locked_acc.user_id, "balance_update", {
        "balance": paise_to_rupees(locked_acc.current_balance_paise),
        "reason": "loan_disbursal",
    })

    return LoanOut(
        id=str(loan.id),
        loan_code=loan.loan_code,
        type=loan.loan_type,
        lender=loan.lender,
        principal=paise_to_rupees(loan.principal_paise),
        remainingAmount=paise_to_rupees(loan.remaining_amount_paise),
        monthlyEmi=paise_to_rupees(loan.monthly_emi_paise),
        tenureMonths=loan.tenure_months,
        emisPaid=loan.emis_paid,
        interestRate=loan.interest_rate,
        nextDueDate=loan.next_due_date,
        disbursedAt=loan.disbursed_at,
        status=loan.status,
        disbursalTxnRef=loan.disbursal_txn_ref,
    )


@router.post("/loans/repay")
async def repay_loan_emi(
    payload: RepayLoanRequest,
    user: User = Depends(get_current_user),
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    if user.pin_hash:
        if not payload.pin:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, {"code": "pin_required", "message": "UPI PIN required to repay EMI"})
        try:
            await verify_user_pin(db, user, payload.pin)
        except PinError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, {"code": e.code, "message": e.message})

    amount_paise = rupees_to_paise(payload.amount)

    acc_res = await db.execute(select(Account).where(Account.id == account.id).with_for_update())
    locked_acc = acc_res.scalar_one()

    if locked_acc.current_balance_paise < amount_paise:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Insufficient wallet balance to pay EMI (Available: Rs {paise_to_rupees(locked_acc.current_balance_paise):.2f})",
        )

    # Deduct balance
    locked_acc.current_balance_paise -= amount_paise

    # Find loan in DB or create a tracked entry if it was a default demo loan
    loan_res = await db.execute(
        select(Loan).where(Loan.account_id == locked_acc.id, Loan.loan_code == payload.loan_code)
    )
    loan = loan_res.scalar_one_or_none()

    new_remaining_paise = 0
    new_paid_count = 1
    loan_type_label = "Personal Loan"

    if loan:
        new_remaining_paise = max(0, loan.remaining_amount_paise - amount_paise)
        loan.remaining_amount_paise = new_remaining_paise
        loan.emis_paid += 1
        new_paid_count = loan.emis_paid
        loan_type_label = loan.loan_type
        if new_remaining_paise == 0:
            loan.status = "CLOSED"
    else:
        # If paying a demo loan like LOAN-PERS-8941
        default_rem = rupees_to_paise(48500)
        new_remaining_paise = max(0, default_rem - amount_paise)
        loan = Loan(
            user_id=user.id,
            account_id=locked_acc.id,
            loan_code=payload.loan_code,
            loan_type="Personal Loan",
            lender="HDFC Bank & RenoPay Credit",
            principal_paise=rupees_to_paise(75000),
            remaining_amount_paise=new_remaining_paise,
            monthly_emi_paise=amount_paise,
            tenure_months=18,
            emis_paid=7,
            interest_rate=11.5,
            next_due_date=datetime.now().strftime("%Y-%m-%d"),
            disbursed_at=datetime.now().strftime("%Y-%m-%d"),
            status="ACTIVE" if new_remaining_paise > 0 else "CLOSED",
        )
        db.add(loan)

    txn_ref = generate_txn_ref()
    txn = Transaction(
        txn_group_id=new_txn_group_id(),
        txn_ref=txn_ref,
        account_id=locked_acc.id,
        counterparty_vpa="loans.emi@renopay",
        counterparty_name="RenoPay Lending Services",
        type=TxnType.DEBIT,
        status=TxnStatus.SUCCESS,
        category=TxnCategory.BILLS,
        amount_paise=amount_paise,
        description=f"EMI Repayment for {payload.loan_code} ({loan_type_label})",
        trust_score=99,
    )
    db.add(txn)
    await db.commit()
    await db.refresh(locked_acc)

    try:
        from app.services import accounting_engine
        await accounting_engine.post_transaction_to_journal(db, txn)
    except Exception as e:
        logger.warning("Accounting journal post note: %s", e)

    # Push live balance update
    await ws_manager.push(locked_acc.user_id, "balance_update", {
        "balance": paise_to_rupees(locked_acc.current_balance_paise),
        "reason": "loan_repayment",
    })

    return {
        "success": True,
        "txn_ref": txn_ref,
        "amount": payload.amount,
        "new_balance": paise_to_rupees(locked_acc.current_balance_paise),
        "loan_code": payload.loan_code,
        "remaining_amount": paise_to_rupees(new_remaining_paise),
        "emis_paid": new_paid_count,
        "status": "CLOSED" if new_remaining_paise == 0 else "ACTIVE",
    }


@router.get("/loans", response_model=list[LoanOut])
async def get_loans(
    user: User = Depends(get_current_user),
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(Loan).where(Loan.account_id == account.id).order_by(desc(Loan.created_at))
    )
    loans = res.scalars().all()
    if not loans:
        # Seed default loan if none in DB
        default_loan = Loan(
            user_id=user.id,
            account_id=account.id,
            loan_code="LOAN-PERS-8941",
            loan_type="Personal Loan",
            lender="HDFC Bank & RenoPay Credit",
            principal_paise=rupees_to_paise(75000),
            remaining_amount_paise=rupees_to_paise(48500),
            monthly_emi_paise=rupees_to_paise(4320),
            tenure_months=18,
            emis_paid=6,
            interest_rate=11.5,
            next_due_date="2026-10-05",
            disbursed_at="2026-03-10",
            status="ACTIVE",
            disbursal_txn_ref="RENO-TXN-INIT-8941",
        )
        db.add(default_loan)
        await db.commit()
        await db.refresh(default_loan)
        loans = [default_loan]

    return [
        LoanOut(
            id=str(l.id),
            loan_code=l.loan_code,
            type=l.loan_type,
            lender=l.lender,
            principal=paise_to_rupees(l.principal_paise),
            remainingAmount=paise_to_rupees(l.remaining_amount_paise),
            monthlyEmi=paise_to_rupees(l.monthly_emi_paise),
            tenureMonths=l.tenure_months,
            emisPaid=l.emis_paid,
            interestRate=l.interest_rate,
            nextDueDate=l.next_due_date,
            disbursedAt=l.disbursed_at,
            status=l.status,
            disbursalTxnRef=l.disbursal_txn_ref,
        )
        for l in loans
    ]


# --------------------------------------------------------------------------
# 3. MUTUAL FUNDS & DAILY RD (INVESTMENTS)
# --------------------------------------------------------------------------
@router.post("/investments/invest")
async def make_investment(
    payload: InvestRequest,
    user: User = Depends(get_current_user),
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    if user.pin_hash and payload.pin:
        try:
            await verify_user_pin(db, user, payload.pin)
        except PinError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, {"code": e.code, "message": e.message})

    amount_paise = rupees_to_paise(payload.amount)

    acc_res = await db.execute(select(Account).where(Account.id == account.id).with_for_update())
    locked_acc = acc_res.scalar_one()

    if locked_acc.current_balance_paise < amount_paise:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Insufficient wallet balance to start investment (Available: Rs {paise_to_rupees(locked_acc.current_balance_paise):.2f})",
        )

    # Deduct balance
    locked_acc.current_balance_paise -= amount_paise

    txn_ref = generate_txn_ref()
    code_prefix = "SIP" if payload.investment_type == "sip" else "DSIP" if payload.investment_type == "daily_sip" else "RD"
    inv_code = f"{code_prefix}-{random.randint(100, 999)}"

    # Debit ledger transaction
    txn = Transaction(
        txn_group_id=new_txn_group_id(),
        txn_ref=txn_ref,
        account_id=locked_acc.id,
        counterparty_vpa="investments@renopay",
        counterparty_name=payload.fund_name,
        type=TxnType.DEBIT,
        status=TxnStatus.SUCCESS,
        category=TxnCategory.BILLS,
        amount_paise=amount_paise,
        description=f"Investment Allotment: {payload.fund_name} ({payload.investment_type.upper()})",
        trust_score=99,
    )
    db.add(txn)
    await db.flush()

    try:
        from app.services import accounting_engine
        await accounting_engine.post_transaction_to_journal(db, txn)
    except Exception as e:
        logger.warning("Accounting journal post note: %s", e)

    inv = Investment(
        user_id=user.id,
        account_id=locked_acc.id,
        investment_code=inv_code,
        investment_type=payload.investment_type,
        fund_name=payload.fund_name,
        category=payload.category,
        monthly_amount_paise=amount_paise,
        invested_amount_paise=amount_paise,
        current_value_paise=amount_paise,
        next_debit_date="Tomorrow 09:00 AM" if "daily" in payload.investment_type else "5th of next month",
        status="ACTIVE",
        txn_ref=txn_ref,
    )
    db.add(inv)
    await db.commit()
    await db.refresh(locked_acc)

    # Push live balance update
    await ws_manager.push(locked_acc.user_id, "balance_update", {
        "balance": paise_to_rupees(locked_acc.current_balance_paise),
        "reason": "investment_debit",
    })

    return {
        "success": True,
        "txn_ref": txn_ref,
        "amount": payload.amount,
        "new_balance": paise_to_rupees(locked_acc.current_balance_paise),
        "investment_code": inv_code,
        "fund_name": payload.fund_name,
        "status": "ACTIVE",
    }


@router.get("/investments", response_model=list[InvestmentOut])
async def get_investments(
    user: User = Depends(get_current_user),
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(Investment).where(Investment.account_id == account.id).order_by(desc(Investment.created_at))
    )
    items = res.scalars().all()
    if not items:
        # Seed initial investments for demo
        seed1 = Investment(
            user_id=user.id,
            account_id=account.id,
            investment_code="SIP-01",
            investment_type="sip",
            fund_name="Parag Parikh Flexi Cap Fund",
            category="Equity - Flexi Cap",
            monthly_amount_paise=rupees_to_paise(2000),
            invested_amount_paise=rupees_to_paise(8000),
            current_value_paise=rupees_to_paise(9850),
            next_debit_date="2026-10-02",
            status="ACTIVE",
            txn_ref="RENO-TXN-SIP-1",
        )
        seed2 = Investment(
            user_id=user.id,
            account_id=account.id,
            investment_code="SIP-02",
            investment_type="daily_sip",
            fund_name="Nifty 50 Index Micro Fund",
            category="Daily SIP ₹10",
            monthly_amount_paise=rupees_to_paise(10),
            invested_amount_paise=rupees_to_paise(1500),
            current_value_paise=rupees_to_paise(1820),
            next_debit_date="Daily Auto-Debit",
            status="ACTIVE",
            txn_ref="RENO-TXN-DSIP-2",
        )
        seed3 = Investment(
            user_id=user.id,
            account_id=account.id,
            investment_code="RD-01",
            investment_type="daily_rd",
            fund_name="RenoPay Virtual Bank (7.9% p.a.)",
            category="Recurring Deposit",
            monthly_amount_paise=rupees_to_paise(100),
            invested_amount_paise=rupees_to_paise(5000),
            current_value_paise=rupees_to_paise(5180),
            next_debit_date="Daily Auto-Debit",
            status="ACTIVE",
            txn_ref="RENO-TXN-RD-3",
        )
        db.add_all([seed1, seed2, seed3])
        await db.commit()
        items = [seed1, seed2, seed3]

    return [
        InvestmentOut(
            id=str(i.id),
            investment_code=i.investment_code,
            type=i.investment_type,
            fund_name=i.fund_name,
            category=i.category,
            monthly_amount=paise_to_rupees(i.monthly_amount_paise),
            invested_amount=paise_to_rupees(i.invested_amount_paise),
            current_value=paise_to_rupees(i.current_value_paise),
            next_debit_date=i.next_debit_date,
            status=i.status,
            txn_ref=i.txn_ref,
        )
        for i in items
    ]


# --------------------------------------------------------------------------
# 4. OFFICIAL PDF RECEIPT FOR ANY TRANSACTION
# --------------------------------------------------------------------------
@router.get("/receipt/{txn_ref}/pdf")
async def get_receipt_pdf(
    txn_ref: str,
    disposition: Literal["attachment", "inline"] = Query("inline"),
    user: User = Depends(get_current_user),
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Transaction).where(
            Transaction.txn_ref == txn_ref,
            Transaction.account_id == account.id,
        )
    )
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Transaction {txn_ref} not found")

    content_type = "application/pdf" if PDF_AVAILABLE else "text/html"
    filename_ext = "pdf" if PDF_AVAILABLE else "html"

    data = build_receipt_data(txn)
    buf = await generate_pdf("transaction_receipt", data)

    filename = f"Receipt_{txn_ref}.{filename_ext}"
    headers = {
        "Content-Disposition": f'{disposition}; filename="{filename}"',
        "Access-Control-Expose-Headers": "Content-Disposition",
    }
    return StreamingResponse(buf, media_type=content_type, headers=headers)
