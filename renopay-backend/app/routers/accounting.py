from datetime import datetime, timezone, timedelta
import uuid

IST = timezone(timedelta(hours=5, minutes=30))

def to_ist(dt: datetime | None) -> datetime:
    if not dt:
        return datetime.now(IST)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(IST)

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.api.deps import get_current_account
from app.db.session import get_db
from app.models.account import Account
from app.models.accounting import ChartOfAccount, JournalEntry, JournalLine
from app.services import accounting_engine

router = APIRouter()

class DevModeRequest(BaseModel):
    enabled: bool

@router.patch("/dev-mode")
async def toggle_dev_mode(
    payload: DevModeRequest,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db)
):
    account.dev_mode_enabled = payload.enabled
    await db.commit()
    return {"success": True, "dev_mode_enabled": account.dev_mode_enabled}

@router.get("/chart-of-accounts")
async def get_chart_of_accounts(
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db)
):
    code_map = await accounting_engine.ensure_chart_of_accounts(db, account.id)
    # Convert code_map to a list of dicts for the frontend
    result = []
    for code, coa in code_map.items():
        result.append({
            "id": str(coa.id),
            "code": coa.code,
            "name": coa.name,
            "type": coa.account_type.value
        })
    return result

@router.get("/journal")
async def get_journal(
    from_date: str = Query(None, alias="from"),
    to_date: str = Query(None, alias="to"),
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db)
):
    dt_from = None
    dt_to = None
    if from_date:
        try:
            dt_from = datetime.strptime(from_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    if to_date:
        try:
            dt_to = datetime.strptime(to_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
        except ValueError:
            pass

    query = select(JournalEntry).where(JournalEntry.account_id == account.id)
    if dt_from:
        query = query.where(JournalEntry.created_at >= dt_from)
    if dt_to:
        query = query.where(JournalEntry.created_at <= dt_to)
    query = query.order_by(JournalEntry.created_at.desc()).limit(500)

    result = await db.execute(query)
    entries = result.scalars().all()
    
    response = []
    for entry in entries:
        lines_result = await db.execute(
            select(JournalLine, ChartOfAccount.name)
            .join(ChartOfAccount, JournalLine.chart_account_id == ChartOfAccount.id)
            .where(JournalLine.journal_entry_id == entry.id)
        )
        lines = []
        for line, coa_name in lines_result.all():
            lines.append({
                "account_name": coa_name,
                "debit": line.debit_paise / 100 if line.debit_paise else 0,
                "credit": line.credit_paise / 100 if line.credit_paise else 0,
                "payee": line.payee_vpa or line.payee_name
            })
        
        response.append({
            "entry_no": entry.entry_no,
            "date": to_ist(entry.created_at).strftime("%d %b %Y %I:%M %p"),
            "narration": entry.narration,
            "source": entry.source.value,
            "lines": lines
        })
    return response

@router.get("/ledger/{chart_account_id}")
async def get_ledger(
    chart_account_id: uuid.UUID,
    from_date: str = Query(None, alias="from"),
    to_date: str = Query(None, alias="to"),
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db)
):
    dt_from = None
    dt_to = None
    if from_date:
        try:
            dt_from = datetime.strptime(from_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    if to_date:
        try:
            dt_to = datetime.strptime(to_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
        except ValueError:
            pass

    data = await accounting_engine.get_ledger_for_account(db, chart_account_id, dt_from, dt_to, account_id=account.id)
    if not data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
        
    lines = []
    for line in data["lines"]:
        lines.append({
            "date": line["date"].strftime("%d %b %Y"),
            "entry_no": line["entry_no"],
            "narration": line["narration"],
            "debit": line["debit"] / 100 if line["debit"] else 0,
            "credit": line["credit"] / 100 if line["credit"] else 0,
            "balance": line["balance"] / 100,
            "payee": line["payee"]
        })
        
    return {
        "account_code": data["coa"].code,
        "account_name": data["coa"].name,
        "account_type": data["coa"].account_type.value,
        "lines": lines,
        "closing_balance": data["closing_balance"] / 100
    }

@router.get("/ledger/payee/{payee_vpa}")
async def get_payee_ledger(
    payee_vpa: str,
    from_date: str = Query(None, alias="from"),
    to_date: str = Query(None, alias="to"),
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db)
):
    dt_from = None
    dt_to = None
    if from_date:
        try:
            dt_from = datetime.strptime(from_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    if to_date:
        try:
            dt_to = datetime.strptime(to_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
        except ValueError:
            pass

    data = await accounting_engine.get_ledger_for_payee(db, account.id, payee_vpa, dt_from, dt_to)
    
    lines = []
    for line in data["lines"]:
        lines.append({
            "date": line["date"].strftime("%d %b %Y"),
            "entry_no": line["entry_no"],
            "narration": line["narration"],
            "account_name": line["account_name"],
            "debit": line["debit"] / 100 if line["debit"] else 0,
            "credit": line["credit"] / 100 if line["credit"] else 0,
        })
        
    return {
        "payee_vpa": data["payee_vpa"],
        "lines": lines,
        "total_debit": data["total_debit"] / 100,
        "total_credit": data["total_credit"] / 100,
        "net": data["net"] / 100
    }

@router.get("/trial-balance")
async def get_trial_balance_api(
    as_of: str = Query(None),
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db)
):
    # Ensure COA exists
    await accounting_engine.ensure_chart_of_accounts(db, account.id)
    
    dt_as_of = None
    if as_of:
        try:
            dt_as_of = datetime.strptime(as_of, "%Y-%m-%d").replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid date format. Use YYYY-MM-DD")
            
    data = await accounting_engine.get_trial_balance(db, account.id, dt_as_of)
    
    rows = []
    for row in data["rows"]:
        rows.append({
            "id": str(row["id"]),
            "code": row["code"],
            "name": row["name"],
            "debit": row["debit"] / 100 if row["debit"] else 0,
            "credit": row["credit"] / 100 if row["credit"] else 0
        })
        
    return {
        "rows": rows,
        "total_debit": data["total_debit"] / 100,
        "balanced": data["balanced"]
    }

@router.get("/pnl")
async def get_profit_and_loss_api(
    from_date: str = Query(None, alias="from"),
    to_date: str = Query(None, alias="to"),
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db)
):
    """Profit & Loss Statement (Income Statement) over a date range."""
    dt_from = None
    dt_to = None
    if from_date:
        try:
            dt_from = datetime.strptime(from_date, "%Y-%m-%d").replace(hour=0, minute=0, second=0, tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid from date format. Use YYYY-MM-DD")
    if to_date:
        try:
            dt_to = datetime.strptime(to_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid to date format. Use YYYY-MM-DD")
            
    return await accounting_engine.get_profit_and_loss(db, account.id, dt_from, dt_to)


@router.get("/balance-sheet")
async def get_balance_sheet_api(
    as_of: str = Query(None),
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db)
):
    """Balance Sheet statement at a single point in time."""
    dt_as_of = None
    if as_of:
        try:
            dt_as_of = datetime.strptime(as_of, "%Y-%m-%d").replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid as_of date format. Use YYYY-MM-DD")
            
    return await accounting_engine.get_balance_sheet(db, account.id, dt_as_of)


@router.get("/cash-flow")
async def get_cash_flow_api(
    from_date: str = Query(None, alias="from"),
    to_date: str = Query(None, alias="to"),
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db)
):
    """Direct Method Cash Flow Statement tracking real digital cash movements."""
    dt_from = None
    dt_to = None
    if from_date:
        try:
            dt_from = datetime.strptime(from_date, "%Y-%m-%d").replace(hour=0, minute=0, second=0, tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid from date format. Use YYYY-MM-DD")
    if to_date:
        try:
            dt_to = datetime.strptime(to_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid to date format. Use YYYY-MM-DD")
            
    return await accounting_engine.get_cash_flow_statement(db, account.id, dt_from, dt_to)

@router.get("/reports/gst")
async def get_gst_report(
    from_date: str = Query(None, alias="from"),
    to_date: str = Query(None, alias="to"),
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db)
):
    """Generate GST GSTR-1 / GSTR-3B compliance report."""
    dt_from = None
    dt_to = None
    if from_date:
        try:
            dt_from = datetime.strptime(from_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    if to_date:
        try:
            dt_to = datetime.strptime(to_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
        except ValueError:
            pass
            
    data = await accounting_engine.generate_gst_report(db, account.id, dt_from, dt_to)
    
    # Format paise to rupees for API response
    return {
        "inward_supplies": {
            "total_taxable": data["inward_supplies"]["total_taxable"] / 100,
            "total_tax": data["inward_supplies"]["total_tax"] / 100,
            "items": [
                {
                    "name": i["name"],
                    "hsn_sac_code": i["hsn_sac_code"],
                    "taxable_value": i["taxable_value"] / 100,
                    "estimated_tax": i["estimated_tax"] / 100
                } for i in data["inward_supplies"]["items"]
            ]
        },
        "outward_supplies": {
            "total_taxable": data["outward_supplies"]["total_taxable"] / 100,
            "total_tax": data["outward_supplies"]["total_tax"] / 100,
            "items": [
                {
                    "name": i["name"],
                    "hsn_sac_code": i["hsn_sac_code"],
                    "taxable_value": i["taxable_value"] / 100,
                    "estimated_tax": i["estimated_tax"] / 100
                } for i in data["outward_supplies"]["items"]
            ]
        },
        "net_gst_payable": data["net_gst_payable"] / 100
    }

class PayrollEmployee(BaseModel):
    name: str
    salary: float

class PayrollRequest(BaseModel):
    employees: list[PayrollEmployee]

@router.post("/payroll/generate")
async def generate_payroll(
    payload: PayrollRequest,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db)
):
    """Generate salary slips and book payroll journals."""
    if not payload.employees:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No employees provided")
        
    employees = [{"name": e.name, "salary_paise": int(e.salary * 100)} for e in payload.employees]
    
    entry = await accounting_engine.book_payroll(db, account.id, employees)
    await db.commit()
    
    return {
        "success": True, 
        "entry_no": entry.entry_no, 
        "message": f"Payroll booked for {len(employees)} employees"
    }

class InvoiceCreate(BaseModel):
    customer_name: str
    amount: float

@router.post("/invoices")
async def create_invoice_endpoint(
    payload: InvoiceCreate,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db)
):
    """Create a new invoice and book Accounts Receivable."""
    if payload.amount <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Amount must be positive")
        
    invoice = await accounting_engine.create_invoice(
        db, account.id, payload.customer_name, int(payload.amount * 100)
    )
    await db.commit()
    
    return {
        "id": invoice.id,
        "invoice_no": invoice.invoice_no,
        "customer_name": invoice.customer_name,
        "amount": invoice.amount_paise / 100,
        "status": invoice.status
    }

@router.get("/invoices")
async def get_invoices(
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db)
):
    """List all invoices."""
    from app.models.accounting import Invoice
    result = await db.execute(
        select(Invoice)
        .where(Invoice.account_id == account.id)
        .order_by(Invoice.created_at.desc())
    )
    invoices = result.scalars().all()
    return [
        {
            "id": i.id,
            "invoice_no": i.invoice_no,
            "customer_name": i.customer_name,
            "amount": i.amount_paise / 100,
            "status": i.status,
            "created_at": i.created_at
        } for i in invoices
    ]

@router.post("/invoices/{invoice_id}/pay")
async def pay_invoice_endpoint(
    invoice_id: uuid.UUID,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db)
):
    """Mark an invoice as paid and book the cash receipt."""
    try:
        invoice = await accounting_engine.pay_invoice(db, account.id, invoice_id)
        await db.commit()
        return {
            "success": True,
            "message": f"Invoice {invoice.invoice_no} marked as paid",
            "status": invoice.status
        }
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
