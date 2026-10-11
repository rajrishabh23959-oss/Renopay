"""
Negative authorization / IDOR regression test suite.
Validates multi-tenant isolation across Khatabook, General Ledger Accounting, and Accounts.
"""
import uuid
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.core.security import create_access_token
from tests.conftest import make_user_with_account
from app.models.shopkeeper import KhatabookCustomer
from app.models.accounting import ChartOfAccount, AccountType


async def test_khatabook_customer_idor_isolation(engine):
    """
    User A attempts to access User B's Khatabook customer record.
    Must return 404 Not Found (zero information leakage about other tenant existence).
    """
    from sqlalchemy.ext.asyncio import async_sessionmaker
    session_factory = async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)

    # 1. Create User A and User B
    setup_session = session_factory()
    user_a, _ = await make_user_with_account(setup_session, name="User Alpha", phone=f"91{str(uuid.uuid4().int)[:8]}", pin="111111")
    user_b, _ = await make_user_with_account(setup_session, name="User Bravo", phone=f"92{str(uuid.uuid4().int)[:8]}", pin="222222")

    # 2. Add customer owned by User B
    cust_b = KhatabookCustomer(
        merchant_user_id=user_b.id,
        name="User B Private Customer",
        phone="9988776655",
        net_balance_paise=5000,
    )
    setup_session.add(cust_b)
    await setup_session.commit()
    await setup_session.refresh(cust_b)
    cust_b_id = cust_b.id
    await setup_session.close()

    # 3. User A requests User B's customer
    token_a = create_access_token(user_a.id)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(
            f"/khatabook/customers/{cust_b_id}",
            headers={"Authorization": f"Bearer {token_a}"},
        )
        assert resp.status_code == 404, f"IDOR vulnerability! Expected 404, got {resp.status_code}: {resp.text}"


async def test_accounting_ledger_idor_isolation(engine):
    """
    User A attempts to query General Ledger entries for a Chart of Accounts node owned by User B.
    Must return 404 Not Found (tenant-isolated).
    """
    from sqlalchemy.ext.asyncio import async_sessionmaker
    session_factory = async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)

    setup_session = session_factory()
    user_a, acc_a = await make_user_with_account(setup_session, name="Tenant A", phone=f"93{str(uuid.uuid4().int)[:8]}", pin="111111")
    user_b, acc_b = await make_user_with_account(setup_session, name="Tenant B", phone=f"94{str(uuid.uuid4().int)[:8]}", pin="222222")

    coa_b = ChartOfAccount(
        account_id=acc_b.id,
        code=f"VAULT-{str(uuid.uuid4())[:6]}",
        name="User B Private Vault",
        account_type=AccountType.ASSET,
    )
    setup_session.add(coa_b)
    await setup_session.commit()
    await setup_session.refresh(coa_b)
    coa_b_id = coa_b.id
    await setup_session.close()

    token_a = create_access_token(user_a.id)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(
            f"/accounting/ledger/{coa_b_id}",
            headers={"Authorization": f"Bearer {token_a}"},
        )
        assert resp.status_code == 404, f"IDOR vulnerability in accounting! Expected 404, got {resp.status_code}"
