"""
High-concurrency stress test suite for RenoPay payment engine.
Proves ACID guarantees, double-spend prevention via SELECT ... FOR UPDATE,
and idempotency key deduplication under race conditions.
"""
import asyncio
import uuid
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models.account import Account
from app.services import payment_engine
from app.services.payment_engine import PaymentError
from tests.conftest import make_user_with_account


async def test_ten_concurrent_payments_exact_drain(engine):
    """
    Spawns 10 concurrent payments on ONE account with initial balance = 1000 paise (₹10.00).
    Each payment requests 200 paise (₹2.00).
    Total requested: 2000 paise across 10 threads, against 1000 paise available.
    
    ACID requirement:
    - Exactly 5 payments must succeed (5 * 200 = 1000 paise).
    - Exactly 5 payments must fail with 'insufficient_balance'.
    - Account final balance MUST be exactly 0 paise (no negative balances, no double-spends).
    """
    if engine.dialect.name == "sqlite":
        pytest.skip("SQLite does not support row-level locking (SELECT ... FOR UPDATE)")

    session_factory = async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)

    # 1. Setup Sender with exactly 1000 paise and Receiver
    setup_session = session_factory()
    sender_phone = f"98{str(uuid.uuid4().int)[:8]}"
    receiver_phone = f"97{str(uuid.uuid4().int)[:8]}"
    sender, sender_acc = await make_user_with_account(
        setup_session, name="Concurrency Stress Sender", phone=sender_phone, pin="111111", balance_paise=1000
    )
    _, receiver_acc = await make_user_with_account(
        setup_session, name="Concurrency Stress Receiver", phone=receiver_phone, pin="222222", balance_paise=0
    )
    sender_id = sender.id
    receiver_vpa = receiver_acc.vpa
    sender_acc_id = sender_acc.id
    receiver_acc_id = receiver_acc.id
    await setup_session.close()

    # 2. Worker coroutine using independent asyncpg connection
    async def process_debit():
        session = session_factory()
        try:
            res = await payment_engine.send_money(
                session,
                sender_user_id=sender_id,
                receiver_vpa=receiver_vpa,
                amount_paise=200,
                pin="111111",
                skip_round_up=True,
            )
            return ("success", res)
        except PaymentError as pe:
            return ("failed", pe.code)
        except Exception as e:
            return ("error", str(e))
        finally:
            await session.close()

    # 3. Fire all 10 payments concurrently
    results = await asyncio.gather(*[process_debit() for _ in range(10)])

    successes = [r for r in results if r[0] == "success"]
    failures = [r for r in results if r[0] == "failed"]

    assert len(successes) == 5, f"Expected exactly 5 successful debits, got {len(successes)}"
    assert len(failures) == 5, f"Expected exactly 5 failures, got {len(failures)}"

    for fail in failures:
        assert fail[1] == "insufficient_balance", f"Failure reason must be insufficient_balance, got {fail[1]}"

    # 4. Verify DB state directly
    verify_session = session_factory()
    final_sender = (await verify_session.execute(select(Account).where(Account.id == sender_acc_id))).scalar_one()
    final_receiver = (await verify_session.execute(select(Account).where(Account.id == receiver_acc_id))).scalar_one()

    assert final_sender.current_balance_paise == 0, f"Sender balance must be exactly 0, found {final_sender.current_balance_paise}"
    assert final_receiver.current_balance_paise == 1000, f"Receiver balance must be exactly 1000, found {final_receiver.current_balance_paise}"
    await verify_session.close()


async def test_duplicate_idempotency_key_concurrent_requests(engine):
    """
    Fires 5 concurrent payment requests sharing the EXACT SAME idempotency_key.
    
    ACID requirement:
    - Sender account must be debited EXACTLY ONCE.
    - Other requests must either return the cached payment result or fail with 'idempotency_conflict'.
    - Double debits are strictly impossible.
    """
    if engine.dialect.name == "sqlite":
        pytest.skip("SQLite does not support row-level locking (SELECT ... FOR UPDATE)")

    session_factory = async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)

    setup_session = session_factory()
    sender_phone = f"96{str(uuid.uuid4().int)[:8]}"
    receiver_phone = f"95{str(uuid.uuid4().int)[:8]}"
    sender, sender_acc = await make_user_with_account(
        setup_session, name="Idempotency Sender", phone=sender_phone, pin="111111", balance_paise=5000
    )
    _, receiver_acc = await make_user_with_account(
        setup_session, name="Idempotency Receiver", phone=receiver_phone, pin="222222", balance_paise=0
    )
    sender_id = sender.id
    receiver_vpa = receiver_acc.vpa
    sender_acc_id = sender_acc.id
    shared_key = f"idem-key-{uuid.uuid4()}"
    await setup_session.close()

    async def attempt_idempotent_payment():
        session = session_factory()
        try:
            res = await payment_engine.send_money(
                session,
                sender_user_id=sender_id,
                receiver_vpa=receiver_vpa,
                amount_paise=1000,
                pin="111111",
                idempotency_key=shared_key,
                skip_round_up=True,
            )
            return ("success", res.txn_ref)
        except PaymentError as pe:
            return ("handled_conflict", pe.code)
        finally:
            await session.close()

    # Fire 5 concurrent requests with identical idempotency key
    results = await asyncio.gather(*[attempt_idempotent_payment() for _ in range(5)])

    # Verify how many executed
    successful_txns = {r[1] for r in results if r[0] == "success"}
    assert len(successful_txns) <= 1, f"Expected at most 1 unique transaction ref, got {successful_txns}"

    # Verify final balance: only 1000 paise must have been deducted
    verify_session = session_factory()
    final_sender = (await verify_session.execute(select(Account).where(Account.id == sender_acc_id))).scalar_one()
    assert final_sender.current_balance_paise == 4000, f"Expected balance 4000 (5000 - 1000), got {final_sender.current_balance_paise}"
    await verify_session.close()
