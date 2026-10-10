import uuid
from datetime import datetime

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.accounting import (
    ChartOfAccount, AccountType, JournalEntry, JournalSource, JournalLine, LedgerAuditLog
)
from app.models.transaction import Transaction, TxnType, TxnCategory

# Default Ledger Heads
# We will create these for each account as needed.
DEFAULT_ASSETS = [
    ("1000", "Cash/Bank", AccountType.ASSET),
    ("1100", "Digital Gold", AccountType.ASSET),
    ("1200", "UPI Lite Wallet", AccountType.ASSET),
]
DEFAULT_LIABILITIES = [
    ("2000", "Accounts Payable", AccountType.LIABILITY),
]
DEFAULT_EQUITY = [
    ("3000", "Owner's Equity", AccountType.EQUITY),
]
DEFAULT_INCOME = [
    ("4000", "General Income", AccountType.INCOME),
]
# We map TxnCategory to specific expense/income heads
TXN_CATEGORY_MAP = {
    TxnCategory.FOOD: ("5010", "Food & Dining", AccountType.EXPENSE),
    TxnCategory.SHOPPING: ("5020", "Shopping", AccountType.EXPENSE),
    TxnCategory.TRANSPORT: ("5030", "Transport", AccountType.EXPENSE),
    TxnCategory.ENTERTAINMENT: ("5040", "Entertainment", AccountType.EXPENSE),
    TxnCategory.BILLS: ("5050", "Bills & Utilities", AccountType.EXPENSE),
    TxnCategory.HEALTH: ("5060", "Health & Medical", AccountType.EXPENSE),
    TxnCategory.EDUCATION: ("5070", "Education", AccountType.EXPENSE),
    TxnCategory.INCOME: ("4100", "Salary / Direct Income", AccountType.INCOME),
    TxnCategory.OTHER: ("5090", "Other Expenses", AccountType.EXPENSE),
}

async def ensure_chart_of_accounts(db: AsyncSession, account_id: uuid.UUID) -> dict[str, ChartOfAccount]:
    """Ensures the default chart of accounts exists for a given user account and returns a code->COA map."""
    result = await db.execute(select(ChartOfAccount).where(ChartOfAccount.account_id == account_id))
    existing_coas = result.scalars().all()
    
    code_map = {coa.code.split('-')[1] if '-' in coa.code else coa.code: coa for coa in existing_coas}
    
    needed_heads = DEFAULT_ASSETS + DEFAULT_LIABILITIES + DEFAULT_EQUITY + DEFAULT_INCOME + list(TXN_CATEGORY_MAP.values())
    
    new_coas = []
    for code, name, acct_type in needed_heads:
        if code not in code_map:
            # We prefix code with account_id snippet to keep it globally unique per DB constraint, 
            # or we remove the unique constraint on `code` and make `(account_id, code)` unique.
            # Wait, the migration made `code` unique. So we must prefix it.
            unique_code = f"{str(account_id)[:8]}-{code}"
            coa = ChartOfAccount(
                account_id=account_id,
                code=unique_code,
                name=name,
                account_type=acct_type
            )
            new_coas.append(coa)
            code_map[code] = coa
            
    if new_coas:
        db.add_all(new_coas)
        await db.flush()
        
    return code_map


async def _generate_entry_no(db: AsyncSession, account_id: uuid.UUID) -> str:
    # A simple sequential entry number generator per account
    result = await db.execute(
        select(func.count(JournalEntry.id)).where(JournalEntry.account_id == account_id)
    )
    count = result.scalar() or 0
    return f"JE-{count + 1:06d}"


async def post_transaction_to_journal(db: AsyncSession, txn: Transaction) -> JournalEntry | None:
    """Core function to post a transaction to the double-entry journal."""
    
    # Check if it was already posted
    result = await db.execute(select(JournalEntry).where(JournalEntry.txn_group_id == txn.txn_group_id, JournalEntry.account_id == txn.account_id))
    if result.scalar_one_or_none():
        return None  # Already posted
        
    code_map = await ensure_chart_of_accounts(db, txn.account_id)
    
    cash_coa = code_map["1000"]
    lite_coa = code_map["1200"]
    gold_coa = code_map["1100"]
    
    entry = JournalEntry(
        entry_no=await _generate_entry_no(db, txn.account_id),
        account_id=txn.account_id,
        txn_group_id=txn.txn_group_id,
        narration=txn.description or f"{txn.type.value.capitalize()} transaction",
        source=JournalSource.AUTO_TXN
    )
    db.add(entry)
    await db.flush()
    
    lines = []
    
    # Determine the primary asset account (Cash vs UPI Lite)
    asset_coa = lite_coa if getattr(txn, 'is_upi_lite', False) else cash_coa
    
    if txn.type == TxnType.DEBIT:
        # Credit Asset, Debit Expense
        expense_code = TXN_CATEGORY_MAP.get(txn.category, TXN_CATEGORY_MAP[TxnCategory.OTHER])[0]
        expense_coa = code_map[expense_code]
        
        lines.append(JournalLine(
            journal_entry_id=entry.id,
            chart_account_id=asset_coa.id,
            debit_paise=0,
            credit_paise=txn.amount_paise,
            payee_vpa=txn.counterparty_vpa,
            payee_name=txn.counterparty_name,
        ))
        lines.append(JournalLine(
            journal_entry_id=entry.id,
            chart_account_id=expense_coa.id,
            debit_paise=txn.amount_paise,
            credit_paise=0,
            payee_vpa=txn.counterparty_vpa,
            payee_name=txn.counterparty_name,
        ))
        
        # Round up to Gold
        if txn.round_up_paise and txn.round_up_paise > 0:
            lines.append(JournalLine(
                journal_entry_id=entry.id,
                chart_account_id=asset_coa.id,
                debit_paise=0,
                credit_paise=txn.round_up_paise,
                payee_vpa="gold@renopay",
                payee_name="Digital Gold",
            ))
            lines.append(JournalLine(
                journal_entry_id=entry.id,
                chart_account_id=gold_coa.id,
                debit_paise=txn.round_up_paise,
                credit_paise=0,
                payee_vpa="gold@renopay",
                payee_name="Digital Gold",
            ))
            
    elif txn.type == TxnType.CREDIT:
        # Debit Asset, Credit Income
        income_code = TXN_CATEGORY_MAP.get(txn.category, TXN_CATEGORY_MAP[TxnCategory.INCOME])[0]
        income_coa = code_map[income_code]
        
        lines.append(JournalLine(
            journal_entry_id=entry.id,
            chart_account_id=asset_coa.id,
            debit_paise=txn.amount_paise,
            credit_paise=0,
            payee_vpa=txn.counterparty_vpa,
            payee_name=txn.counterparty_name,
        ))
        lines.append(JournalLine(
            journal_entry_id=entry.id,
            chart_account_id=income_coa.id,
            debit_paise=0,
            credit_paise=txn.amount_paise,
            payee_vpa=txn.counterparty_vpa,
            payee_name=txn.counterparty_name,
        ))
        
    # Validation: Sum of debits == Sum of credits
    total_debit = sum((line.debit_paise or 0) for line in lines)
    total_credit = sum((line.credit_paise or 0) for line in lines)
    if total_debit != total_credit:
        raise ValueError(f"Journal entry does not balance: Debits={total_debit}, Credits={total_credit}")
        
    db.add_all(lines)
    
    # Audit log
    audit_log = LedgerAuditLog(
        journal_entry_id=entry.id,
        action="created",
        actor="system",
        diff={"txn_group_id": str(txn.txn_group_id), "lines": len(lines)}
    )
    db.add(audit_log)
    
    return entry


async def get_ledger_for_account(
    db: AsyncSession,
    chart_account_id: uuid.UUID,
    from_date: datetime = None,
    to_date: datetime = None,
    account_id: uuid.UUID | None = None,
):
    """Returns T-account structure for a given ledger head, strictly scoped to account_id."""
    coa = await db.get(ChartOfAccount, chart_account_id)
    if not coa:
        return None
    if account_id is not None and coa.account_id != account_id:
        return None
        
    query = (
        select(JournalLine, JournalEntry)
        .join(JournalEntry, JournalLine.journal_entry_id == JournalEntry.id)
        .where(JournalLine.chart_account_id == chart_account_id)
    )
    if from_date:
        query = query.where(JournalEntry.created_at >= from_date)
    if to_date:
        query = query.where(JournalEntry.created_at <= to_date)
    query = query.order_by(JournalEntry.created_at)
    
    result = await db.execute(query)
    
    lines = []
    running_balance = 0
    for line, entry in result.all():
        d = line.debit_paise or 0
        c = line.credit_paise or 0
        if coa.account_type in (AccountType.ASSET, AccountType.EXPENSE):
            running_balance += (d - c)
        else:
            running_balance += (c - d)
            
        lines.append({
            "date": entry.created_at,
            "entry_no": entry.entry_no,
            "narration": entry.narration,
            "debit": d,
            "credit": c,
            "balance": running_balance,
            "payee": line.payee_vpa or line.payee_name
        })
        
    return {
        "coa": coa,
        "lines": lines,
        "closing_balance": running_balance
    }


async def get_ledger_for_payee(db: AsyncSession, account_id: uuid.UUID, payee_vpa: str, from_date: datetime = None, to_date: datetime = None):
    """Returns T-account structure scoped to one payee."""
    query = (
        select(JournalLine, JournalEntry, ChartOfAccount)
        .join(JournalEntry, JournalLine.journal_entry_id == JournalEntry.id)
        .join(ChartOfAccount, JournalLine.chart_account_id == ChartOfAccount.id)
        .where(JournalEntry.account_id == account_id, JournalLine.payee_vpa == payee_vpa)
    )
    if from_date:
        query = query.where(JournalEntry.created_at >= from_date)
    if to_date:
        query = query.where(JournalEntry.created_at <= to_date)
    query = query.order_by(JournalEntry.created_at)

    result = await db.execute(query)
    
    lines = []
    # For a payee ledger, we typically look at Accounts Payable / Receivable.
    # We will just show raw debits and credits for that payee.
    total_debit = 0
    total_credit = 0
    
    for line, entry, coa in result.all():
        d = line.debit_paise or 0
        c = line.credit_paise or 0
        total_debit += d
        total_credit += c
        lines.append({
            "date": entry.created_at,
            "entry_no": entry.entry_no,
            "narration": entry.narration,
            "account_name": coa.name,
            "debit": d,
            "credit": c
        })
        
    return {
        "payee_vpa": payee_vpa,
        "lines": lines,
        "total_debit": total_debit,
        "total_credit": total_credit,
        "net": total_debit - total_credit
    }


async def get_trial_balance(db: AsyncSession, account_id: uuid.UUID, as_of: datetime = None):
    query = (
        select(
            ChartOfAccount.id,
            ChartOfAccount.code,
            ChartOfAccount.name,
            func.sum(JournalLine.debit_paise).label("total_debit"),
            func.sum(JournalLine.credit_paise).label("total_credit")
        )
        .join(JournalLine, ChartOfAccount.id == JournalLine.chart_account_id)
        .join(JournalEntry, JournalLine.journal_entry_id == JournalEntry.id)
        .where(JournalEntry.account_id == account_id)
    )
    
    if as_of:
        query = query.where(JournalEntry.created_at <= as_of)
        
    query = query.group_by(ChartOfAccount.id, ChartOfAccount.code, ChartOfAccount.name).order_by(ChartOfAccount.code)
    
    result = await db.execute(query)
    
    rows = []
    total_debit = 0
    total_credit = 0
    
    for row in result.all():
        d = int(row.total_debit or 0)
        c = int(row.total_credit or 0)
        
        # Calculate net balance for the trial balance presentation
        net_d = d - c if d > c else 0
        net_c = c - d if c > d else 0
        
        total_debit += net_d
        total_credit += net_c
        
        rows.append({
            "id": row.id,
            "code": row.code.split('-')[1] if '-' in row.code else row.code,
            "name": row.name,
            "debit": net_d,
            "credit": net_c
        })
        
    return {
        "rows": rows,
        "total_debit": total_debit,
        "total_credit": total_credit,
        "balanced": total_debit == total_credit
    }


async def get_profit_and_loss(db: AsyncSession, account_id: uuid.UUID, from_date: datetime = None, to_date: datetime = None):
    """
    Calculates Profit & Loss Statement (Income Statement).
    Formula: Total Income - Total Expenses = Net Profit / Loss
    Groups Income and Expense accounts by category/head with exact debits and credits.
    """
    await ensure_chart_of_accounts(db, account_id)
    
    query = (
        select(
            ChartOfAccount.id,
            ChartOfAccount.code,
            ChartOfAccount.name,
            ChartOfAccount.account_type,
            func.sum(JournalLine.debit_paise).label("debit"),
            func.sum(JournalLine.credit_paise).label("credit")
        )
        .join(JournalLine, ChartOfAccount.id == JournalLine.chart_account_id)
        .join(JournalEntry, JournalLine.journal_entry_id == JournalEntry.id)
        .where(JournalEntry.account_id == account_id)
        .where(ChartOfAccount.account_type.in_([AccountType.INCOME, AccountType.EXPENSE]))
    )
    
    if from_date:
        query = query.where(JournalEntry.created_at >= from_date)
    if to_date:
        query = query.where(JournalEntry.created_at <= to_date)
        
    query = query.group_by(ChartOfAccount.id, ChartOfAccount.code, ChartOfAccount.name, ChartOfAccount.account_type).order_by(ChartOfAccount.code)
    result = await db.execute(query)
    
    income_rows = []
    expense_rows = []
    total_income_paise = 0
    total_expense_paise = 0
    
    for row in result.all():
        d = int(row.debit or 0)
        c = int(row.credit or 0)
        clean_code = row.code.split('-')[1] if '-' in row.code else row.code
        
        if row.account_type == AccountType.INCOME:
            net_income = c - d
            if net_income != 0:
                income_rows.append({
                    "code": clean_code,
                    "name": row.name,
                    "amount_paise": net_income,
                    "amount": net_income / 100
                })
                total_income_paise += net_income
        elif row.account_type == AccountType.EXPENSE:
            net_expense = d - c
            if net_expense != 0:
                expense_rows.append({
                    "code": clean_code,
                    "name": row.name,
                    "amount_paise": net_expense,
                    "amount": net_expense / 100
                })
                total_expense_paise += net_expense
                
    net_profit_paise = total_income_paise - total_expense_paise
    
    return {
        "income": {
            "rows": income_rows,
            "total_paise": total_income_paise,
            "total": total_income_paise / 100
        },
        "expenses": {
            "rows": expense_rows,
            "total_paise": total_expense_paise,
            "total": total_expense_paise / 100
        },
        "net_profit_paise": net_profit_paise,
        "net_profit": net_profit_paise / 100,
        "is_profit": net_profit_paise >= 0
    }


async def get_balance_sheet(db: AsyncSession, account_id: uuid.UUID, as_of: datetime = None):
    """
    Calculates Balance Sheet at a single point in time.
    Formula: Assets = Liabilities + Equity
    Equity absorbs Net Income (Retained Earnings) up to as_of date.
    """
    await ensure_chart_of_accounts(db, account_id)
    
    query = (
        select(
            ChartOfAccount.id,
            ChartOfAccount.code,
            ChartOfAccount.name,
            ChartOfAccount.account_type,
            func.sum(JournalLine.debit_paise).label("debit"),
            func.sum(JournalLine.credit_paise).label("credit")
        )
        .join(JournalLine, ChartOfAccount.id == JournalLine.chart_account_id)
        .join(JournalEntry, JournalLine.journal_entry_id == JournalEntry.id)
        .where(JournalEntry.account_id == account_id)
    )
    if as_of:
        query = query.where(JournalEntry.created_at <= as_of)
        
    query = query.group_by(ChartOfAccount.id, ChartOfAccount.code, ChartOfAccount.account_type, ChartOfAccount.name).order_by(ChartOfAccount.code)
    result = await db.execute(query)
    
    assets = []
    liabilities = []
    equity = []
    
    total_assets = 0
    total_liabilities = 0
    total_equity = 0
    
    net_income = 0
    
    for row in result.all():
        d = int(row.debit or 0)
        c = int(row.credit or 0)
        clean_code = row.code.split('-')[1] if '-' in row.code else row.code
        
        if row.account_type == AccountType.ASSET:
            bal = d - c
            if bal != 0:
                assets.append({
                    "code": clean_code,
                    "name": row.name,
                    "balance_paise": bal,
                    "balance": bal / 100
                })
                total_assets += bal
        elif row.account_type == AccountType.LIABILITY:
            bal = c - d
            if bal != 0:
                liabilities.append({
                    "code": clean_code,
                    "name": row.name,
                    "balance_paise": bal,
                    "balance": bal / 100
                })
                total_liabilities += bal
        elif row.account_type == AccountType.EQUITY:
            bal = c - d
            if bal != 0:
                equity.append({
                    "code": clean_code,
                    "name": row.name,
                    "balance_paise": bal,
                    "balance": bal / 100
                })
                total_equity += bal
        elif row.account_type == AccountType.INCOME:
            net_income += (c - d)
        elif row.account_type == AccountType.EXPENSE:
            net_income -= (d - c)
            
    # Roll net income into equity as Retained Earnings
    if net_income != 0:
        equity.append({
            "code": "3100",
            "name": "Retained Earnings (Net Profit)",
            "balance_paise": net_income,
            "balance": net_income / 100
        })
        total_equity += net_income
        
    return {
        "assets": {
            "rows": assets,
            "total_paise": total_assets,
            "total": total_assets / 100
        },
        "liabilities": {
            "rows": liabilities,
            "total_paise": total_liabilities,
            "total": total_liabilities / 100
        },
        "equity": {
            "rows": equity,
            "total_paise": total_equity,
            "total": total_equity / 100
        },
        "total_assets_paise": total_assets,
        "total_assets": total_assets / 100,
        "total_liabilities_equity_paise": total_liabilities + total_equity,
        "total_liabilities_equity": (total_liabilities + total_equity) / 100,
        "balanced": total_assets == (total_liabilities + total_equity)
    }

async def get_balance_sheet_v2(db: AsyncSession, account_id: uuid.UUID, as_of: datetime = None):
    # Compatibility wrapper
    bs = await get_balance_sheet(db, account_id, as_of)
    return {
        "assets": [{"name": r["name"], "balance": r["balance_paise"]} for r in bs["assets"]["rows"]],
        "liabilities": [{"name": r["name"], "balance": r["balance_paise"]} for r in bs["liabilities"]["rows"]],
        "equity": [{"name": r["name"], "balance": r["balance_paise"]} for r in bs["equity"]["rows"]],
        "total_assets": bs["total_assets_paise"],
        "total_liabilities": bs["liabilities"]["total_paise"],
        "total_equity": bs["equity"]["total_paise"],
        "balanced": bs["balanced"]
    }


async def get_cash_flow_statement(db: AsyncSession, account_id: uuid.UUID, from_date: datetime = None, to_date: datetime = None):
    """
    Direct Method Cash Flow Statement tracking movements in Cash & Equivalents (Cash/Bank 1000 and UPI Lite 1200).
    Formula: Opening Cash + Operating Cash Flow + Investing Cash Flow + Financing Cash Flow = Closing Cash
    """
    await ensure_chart_of_accounts(db, account_id)
    
    # 1. Opening balance: Net cash balance before from_date
    opening_paise = 0
    if from_date:
        open_query = (
            select(
                func.sum(JournalLine.debit_paise).label("debit"),
                func.sum(JournalLine.credit_paise).label("credit")
            )
            .join(JournalEntry, JournalLine.journal_entry_id == JournalEntry.id)
            .join(ChartOfAccount, JournalLine.chart_account_id == ChartOfAccount.id)
            .where(JournalEntry.account_id == account_id)
            .where(JournalEntry.created_at < from_date)
            .where(ChartOfAccount.code.like("%-1000") | ChartOfAccount.code.like("%-1200") | (ChartOfAccount.code == "1000") | (ChartOfAccount.code == "1200"))
        )
        open_res = await db.execute(open_query)
        open_row = open_res.one_or_none()
        if open_row:
            d = int(open_row.debit or 0)
            c = int(open_row.credit or 0)
            opening_paise = d - c
            
    # 2. Query lines within date range
    query = (
        select(
            ChartOfAccount.code,
            ChartOfAccount.name,
            ChartOfAccount.account_type,
            func.sum(JournalLine.debit_paise).label("debit"),
            func.sum(JournalLine.credit_paise).label("credit")
        )
        .join(JournalLine, ChartOfAccount.id == JournalLine.chart_account_id)
        .join(JournalEntry, JournalLine.journal_entry_id == JournalEntry.id)
        .where(JournalEntry.account_id == account_id)
    )
    if from_date:
        query = query.where(JournalEntry.created_at >= from_date)
    if to_date:
        query = query.where(JournalEntry.created_at <= to_date)
        
    query = query.group_by(ChartOfAccount.code, ChartOfAccount.name, ChartOfAccount.account_type)
    result = await db.execute(query)
    
    operating_in = []
    operating_out = []
    investing_in = []
    investing_out = []
    financing_in = []
    financing_out = []
    
    op_in_total = 0
    op_out_total = 0
    inv_in_total = 0
    inv_out_total = 0
    fin_in_total = 0
    fin_out_total = 0
    
    for row in result.all():
        d = int(row.debit or 0)
        c = int(row.credit or 0)
        clean_code = row.code.split('-')[1] if '-' in row.code else row.code
        
        # Exclude Cash/Bank and UPI Lite accounts themselves (we track counterparties)
        if clean_code in ("1000", "1200"):
            continue
            
        # Investing activities: Digital Gold (1100), Fixed Assets, Vaults, Investments
        if clean_code == "1100" or "Gold" in row.name or "Investment" in row.name or "Mutual" in row.name or "Vault" in row.name:
            # Asset increase (debit) = cash outflow for investment
            # Asset decrease (credit) = cash inflow from disinvestment
            if d > 0:
                investing_out.append({"name": f"{row.name} Purchases", "amount_paise": d, "amount": d / 100})
                inv_out_total += d
            if c > 0:
                investing_in.append({"name": f"{row.name} Redemptions/Sales", "amount_paise": c, "amount": c / 100})
                inv_in_total += c
        # Financing activities: Owner's Equity (3000), Loans (2100)
        elif clean_code in ("3000", "2100") or "Equity" in row.name or "Loan" in row.name or "Capital" in row.name:
            if c > 0:
                financing_in.append({"name": f"{row.name} Injections/Proceeds", "amount_paise": c, "amount": c / 100})
                fin_in_total += c
            if d > 0:
                financing_out.append({"name": f"{row.name} Repayments/Drawings", "amount_paise": d, "amount": d / 100})
                fin_out_total += d
        # Operating activities: Sales/Income (inflow), Expenses/Payables (outflow)
        else:
            if row.account_type == AccountType.INCOME or c > d:
                net_in = c - d if c > d else c
                if net_in > 0:
                    operating_in.append({"name": row.name, "amount_paise": net_in, "amount": net_in / 100})
                    op_in_total += net_in
            if row.account_type == AccountType.EXPENSE or d > c:
                net_out = d - c if d > c else d
                if net_out > 0:
                    operating_out.append({"name": row.name, "amount_paise": net_out, "amount": net_out / 100})
                    op_out_total += net_out
                    
    net_operating = op_in_total - op_out_total
    net_investing = inv_in_total - inv_out_total
    net_financing = fin_in_total - fin_out_total
    net_change = net_operating + net_investing + net_financing
    closing_paise = opening_paise + net_change
    
    return {
        "opening_balance_paise": opening_paise,
        "opening_balance": opening_paise / 100,
        "operating": {
            "inflows": operating_in,
            "outflows": operating_out,
            "inflows_total_paise": op_in_total,
            "inflows_total": op_in_total / 100,
            "outflows_total_paise": op_out_total,
            "outflows_total": op_out_total / 100,
            "net_paise": net_operating,
            "net": net_operating / 100
        },
        "investing": {
            "inflows": investing_in,
            "outflows": investing_out,
            "inflows_total_paise": inv_in_total,
            "inflows_total": inv_in_total / 100,
            "outflows_total_paise": inv_out_total,
            "outflows_total": inv_out_total / 100,
            "net_paise": net_investing,
            "net": net_investing / 100
        },
        "financing": {
            "inflows": financing_in,
            "outflows": financing_out,
            "inflows_total_paise": fin_in_total,
            "inflows_total": fin_in_total / 100,
            "outflows_total_paise": fin_out_total,
            "outflows_total": fin_out_total / 100,
            "net_paise": net_financing,
            "net": net_financing / 100
        },
        "net_change_paise": net_change,
        "net_change": net_change / 100,
        "closing_balance_paise": closing_paise,
        "closing_balance": closing_paise / 100
    }

async def get_cash_flow(db: AsyncSession, account_id: uuid.UUID, from_date: datetime = None, to_date: datetime = None):
    # Compatibility wrapper
    cf = await get_cash_flow_statement(db, account_id, from_date, to_date)
    return {
        "operating": {"items": [{"name": x["name"], "amount": x["amount_paise"]} for x in cf["operating"]["inflows"] + cf["operating"]["outflows"]], "total": cf["operating"]["net_paise"]},
        "investing": {"items": [{"name": x["name"], "amount": x["amount_paise"]} for x in cf["investing"]["inflows"] + cf["investing"]["outflows"]], "total": cf["investing"]["net_paise"]},
        "financing": {"items": [{"name": x["name"], "amount": x["amount_paise"]} for x in cf["financing"]["inflows"] + cf["financing"]["outflows"]], "total": cf["financing"]["net_paise"]},
        "net_change": cf["net_change_paise"]
    }

async def generate_gst_report(db: AsyncSession, account_id: uuid.UUID, from_date: datetime = None, to_date: datetime = None):
    # Query all journal lines associated with ledger heads that have an hsn_sac_code
    query = (
        select(
            ChartOfAccount.name,
            ChartOfAccount.hsn_sac_code,
            ChartOfAccount.account_type,
            func.sum(JournalLine.debit_paise).label("total_debit"),
            func.sum(JournalLine.credit_paise).label("total_credit")
        )
        .join(JournalLine, ChartOfAccount.id == JournalLine.chart_account_id)
        .join(JournalEntry, JournalLine.journal_entry_id == JournalEntry.id)
        .where(JournalEntry.account_id == account_id)
        .where(ChartOfAccount.hsn_sac_code.isnot(None))
    )
    
    if from_date:
        query = query.where(JournalEntry.created_at >= from_date)
    if to_date:
        query = query.where(JournalEntry.created_at <= to_date)
        
    query = query.group_by(ChartOfAccount.id, ChartOfAccount.name, ChartOfAccount.hsn_sac_code, ChartOfAccount.account_type)
    
    result = await db.execute(query)
    
    inward_supplies = []
    outward_supplies = []
    
    total_inward_taxable = 0
    total_inward_tax = 0
    
    total_outward_taxable = 0
    total_outward_tax = 0
    
    GST_RATE = 0.18 # Flat 18% assumption for Phase 2
    
    for row in result.all():
        d = row.total_debit or 0
        c = row.total_credit or 0
        
        if row.account_type == AccountType.EXPENSE:
            # Inward supply (purchases)
            taxable_value = d - c
            if taxable_value > 0:
                tax = taxable_value * GST_RATE
                inward_supplies.append({
                    "name": row.name,
                    "hsn_sac_code": row.hsn_sac_code,
                    "taxable_value": taxable_value,
                    "estimated_tax": tax
                })
                total_inward_taxable += taxable_value
                total_inward_tax += tax
                
        elif row.account_type == AccountType.INCOME:
            # Outward supply (sales)
            taxable_value = c - d
            if taxable_value > 0:
                tax = taxable_value * GST_RATE
                outward_supplies.append({
                    "name": row.name,
                    "hsn_sac_code": row.hsn_sac_code,
                    "taxable_value": taxable_value,
                    "estimated_tax": tax
                })
                total_outward_taxable += taxable_value
                total_outward_tax += tax
                
    return {
        "inward_supplies": {
            "items": inward_supplies,
            "total_taxable": total_inward_taxable,
            "total_tax": total_inward_tax
        },
        "outward_supplies": {
            "items": outward_supplies,
            "total_taxable": total_outward_taxable,
            "total_tax": total_outward_tax
        },
        "net_gst_payable": total_outward_tax - total_inward_tax
    }

async def book_payroll(db: AsyncSession, account_id: uuid.UUID, employees: list[dict]):
    """
    Accepts a list of dicts: [{"name": "Rishab Raj", "salary_paise": 5000000}]
    Books a single journal entry crediting Cash and debiting Salary Expense for each employee.
    """
    code_map = await ensure_chart_of_accounts(db, account_id)
    
    salary_expense_code = "5100"
    if salary_expense_code not in code_map:
        unique_code = f"{str(account_id)[:8]}-{salary_expense_code}"
        salary_coa = ChartOfAccount(
            account_id=account_id,
            code=unique_code,
            name="Payroll & Salaries",
            account_type=AccountType.EXPENSE
        )
        db.add(salary_coa)
        await db.flush()
        code_map[salary_expense_code] = salary_coa
        
    salary_coa = code_map[salary_expense_code]
    cash_coa = code_map["1000"]
    
    entry = JournalEntry(
        entry_no=await _generate_entry_no(db, account_id),
        account_id=account_id,
        narration=f"Payroll for {len(employees)} employees",
        source=JournalSource.MANUAL
    )
    db.add(entry)
    await db.flush()
    
    lines = []
    total_payroll = sum(emp["salary_paise"] for emp in employees)
    
    # Credit Cash for the total amount
    lines.append(JournalLine(
        journal_entry_id=entry.id,
        chart_account_id=cash_coa.id,
        credit_paise=total_payroll,
        payee_vpa="bulk_payroll",
        payee_name="Various Employees",
    ))
    
    # Debit Salary Expense for each employee
    for emp in employees:
        lines.append(JournalLine(
            journal_entry_id=entry.id,
            chart_account_id=salary_coa.id,
            debit_paise=emp["salary_paise"],
            payee_name=emp["name"]
        ))
        
    db.add_all(lines)
    
    # Audit log
    audit_log = LedgerAuditLog(
        journal_entry_id=entry.id,
        action="created",
        actor="system",
        diff={"type": "payroll", "lines": len(lines)}
    )
    db.add(audit_log)
    
    return entry


async def create_invoice(db: AsyncSession, account_id: uuid.UUID, customer_name: str, amount_paise: int):
    """
    Creates an Invoice record and books a journal entry:
    Debit: Accounts Receivable (1200)
    Credit: Sales/Income (4100)
    """
    from app.models.accounting import Invoice, InvoiceStatus
    
    code_map = await ensure_chart_of_accounts(db, account_id)
    
    # We need an Accounts Receivable account (Asset)
    ar_code = "1200"
    if ar_code not in code_map:
        unique_code = f"{str(account_id)[:8]}-{ar_code}"
        ar_coa = ChartOfAccount(
            account_id=account_id,
            code=unique_code,
            name="Accounts Receivable",
            account_type=AccountType.ASSET
        )
        db.add(ar_coa)
        await db.flush()
        code_map[ar_code] = ar_coa
        
    ar_coa = code_map[ar_code]
    sales_coa = code_map["4100"] # We created "Salary / Direct Income" as 4100 in Phase 1
    
    # Create Invoice record
    invoice_no = f"INV-{uuid.uuid4().hex[:6].upper()}"
    invoice = Invoice(
        account_id=account_id,
        invoice_no=invoice_no,
        customer_name=customer_name,
        amount_paise=amount_paise,
        status=InvoiceStatus.PENDING
    )
    db.add(invoice)
    await db.flush()
    
    # Book Journal Entry
    entry = JournalEntry(
        entry_no=await _generate_entry_no(db, account_id),
        account_id=account_id,
        narration=f"Invoice {invoice_no} issued to {customer_name}",
        source=JournalSource.MANUAL
    )
    db.add(entry)
    await db.flush()
    
    db.add_all([
        JournalLine(
            journal_entry_id=entry.id,
            chart_account_id=ar_coa.id,
            debit_paise=amount_paise,
            payee_name=customer_name
        ),
        JournalLine(
            journal_entry_id=entry.id,
            chart_account_id=sales_coa.id,
            credit_paise=amount_paise,
            payee_name=customer_name
        )
    ])
    
    # Link journal entry to invoice
    invoice.creation_journal_id = entry.id
    
    db.add(LedgerAuditLog(
        journal_entry_id=entry.id,
        action="created",
        actor="system",
        diff={"type": "invoice_creation", "invoice_no": invoice_no}
    ))
    
    return invoice

async def pay_invoice(db: AsyncSession, account_id: uuid.UUID, invoice_id: uuid.UUID):
    """
    Marks an Invoice as PAID and books a journal entry:
    Debit: Cash/Bank (1000)
    Credit: Accounts Receivable (1200)
    """
    from app.models.accounting import Invoice, InvoiceStatus
    
    invoice = await db.execute(select(Invoice).where(Invoice.id == invoice_id, Invoice.account_id == account_id))
    invoice = invoice.scalar_one_or_none()
    
    if not invoice:
        raise ValueError("Invoice not found")
        
    if invoice.status != InvoiceStatus.PENDING:
        raise ValueError("Invoice is not pending")
        
    code_map = await ensure_chart_of_accounts(db, account_id)
    
    ar_coa = code_map.get("1200")
    if not ar_coa:
        raise ValueError("Accounts Receivable account missing")
        
    cash_coa = code_map["1000"]
    
    # Update Invoice
    invoice.status = InvoiceStatus.PAID
    
    # Book Journal Entry
    entry = JournalEntry(
        entry_no=await _generate_entry_no(db, account_id),
        account_id=account_id,
        narration=f"Payment received for Invoice {invoice.invoice_no}",
        source=JournalSource.MANUAL
    )
    db.add(entry)
    await db.flush()
    
    db.add_all([
        JournalLine(
            journal_entry_id=entry.id,
            chart_account_id=cash_coa.id,
            debit_paise=invoice.amount_paise,
            payee_name=invoice.customer_name
        ),
        JournalLine(
            journal_entry_id=entry.id,
            chart_account_id=ar_coa.id,
            credit_paise=invoice.amount_paise,
            payee_name=invoice.customer_name
        )
    ])
    
    invoice.payment_journal_id = entry.id
    
    db.add(LedgerAuditLog(
        journal_entry_id=entry.id,
        action="created",
        actor="system",
        diff={"type": "invoice_payment", "invoice_no": invoice.invoice_no}
    ))
    
    return invoice
