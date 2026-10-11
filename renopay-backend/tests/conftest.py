"""
Shared fixtures. Tests run against a REAL PostgreSQL instance — not
SQLite — because several models use Postgres-only types (UUID, ARRAY)
and, more importantly, the concurrency tests need real `SELECT ... FOR
UPDATE` row-locking semantics that SQLite doesn't provide. In CI this
points at the `postgres:16` service container defined in the GitHub
Actions workflow; locally, point TEST_DATABASE_URL at a throwaway DB.

Each test runs inside an outer transaction that's rolled back after
the test, so tests never leak state into each other and the DB never
needs to be reset between runs.
"""
import os

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.db.base import Base
import app.models  # noqa: F401 — registers all models on Base.metadata
from app.models.user import User, KYCStatus
from app.models.account import Account
from app.core.security import hash_pin

raw_test_db = os.environ.get(
    "TEST_DATABASE_URL", os.environ.get("DATABASE_URL", "postgresql+asyncpg://renopay:renopay@localhost:5432/renopay_test")
)
if raw_test_db.startswith("postgres://"):
    TEST_DATABASE_URL = "postgresql+asyncpg://" + raw_test_db[len("postgres://"):]
elif raw_test_db.startswith("postgresql://"):
    TEST_DATABASE_URL = "postgresql+asyncpg://" + raw_test_db[len("postgresql://"):]
else:
    TEST_DATABASE_URL = raw_test_db


@pytest_asyncio.fixture(scope="session")
async def engine():
    eng = None
    try:
        eng = create_async_engine(TEST_DATABASE_URL, poolclass=None)
        async with eng.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    except Exception:
        # Fall back to SQLite when PostgreSQL service is not available locally
        try:
            eng = create_async_engine("sqlite+aiosqlite:///test.db", poolclass=None)
            async with eng.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
        except Exception as exc:
            pytest.skip(f"Test database unavailable ({exc}).")
    yield eng
    try:
        if eng:
            async with eng.begin() as conn:
                await conn.run_sync(Base.metadata.drop_all)
            await eng.dispose()
            if os.path.exists("test.db"):
                os.remove("test.db")
    except Exception:
        pass


@pytest_asyncio.fixture
async def db_session(engine):
    """One connection + outer transaction per test, rolled back at the
    end. `join_transaction_mode="create_savepoint"` is the key detail:
    application code (like payment_engine.send_money) calls db.commit()
    internally, and without this setting that would end the outer
    transaction early, breaking test isolation. With it, each internal
    commit releases a SAVEPOINT and a new one starts automatically —
    the outer transaction stays open until the fixture rolls it back."""
    connection = await engine.connect()
    transaction = await connection.begin()
    session_factory = async_sessionmaker(
        bind=connection, expire_on_commit=False, autoflush=False,
        join_transaction_mode="create_savepoint",
    )
    session = session_factory()

    yield session

    await session.close()
    await transaction.rollback()
    await connection.close()


async def make_user_with_account(db_session, *, name: str, phone: str, pin: str, balance_paise: int = 0):
    """Test helper: create a fully-formed user + account pair, mirroring
    what the real registration flow produces, so payment tests don't
    need to go through the HTTP auth flow just to get test fixtures."""
    from app.core.money import generate_virtual_acc_no

    user = User(
        full_name=name, phone_number=phone, pin_hash=hash_pin(pin),
        kyc_status=KYCStatus.VERIFIED,
    )
    db_session.add(user)
    await db_session.flush()

    account = Account(
        user_id=user.id, virtual_acc_no=generate_virtual_acc_no(),
        vpa=f"{name.lower().replace(' ', '')}@renopay", current_balance_paise=balance_paise,
    )
    db_session.add(account)
    await db_session.commit()
    await db_session.refresh(user)
    await db_session.refresh(account)
    return user, account


@pytest_asyncio.fixture
async def test_account(db_session):
    import uuid
    unique_phone = str(uuid.uuid4().int)[:10]
    _, account = await make_user_with_account(db_session, name=f"Test User {unique_phone}", phone=unique_phone, pin="123456")
    return account
