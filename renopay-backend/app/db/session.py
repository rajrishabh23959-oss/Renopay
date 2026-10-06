import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.pool import NullPool
from app.core.config import settings

# Neon Serverless PostgreSQL connection configuration
connect_args = {
    "command_timeout": 15.0,
}
if "neon.tech" in settings.ASYNC_DATABASE_URL and "ssl=" not in settings.ASYNC_DATABASE_URL:
    connect_args["ssl"] = "require"

is_serverless = bool(os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))

if is_serverless:
    engine = create_async_engine(
        settings.ASYNC_DATABASE_URL,
        echo=settings.DEBUG,
        connect_args=connect_args,
        poolclass=NullPool,
    )
else:
    engine = create_async_engine(
        settings.ASYNC_DATABASE_URL,
        echo=settings.DEBUG,
        connect_args=connect_args,
        pool_pre_ping=True,
        pool_recycle=300,
        pool_size=10,
        max_overflow=10,
        pool_timeout=15.0,
    )

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)

_db_initialized = False

async def init_db_if_needed():
    global _db_initialized
    if _db_initialized:
        return
    try:
        from app.db.base import Base
        import app.models  # noqa: F401
        from app.models.user import User, KYCStatus
        from app.models.account import Account
        from app.core.security import hash_pin
        from app.core.money import generate_virtual_acc_no
        from sqlalchemy import select, text

        # 1. Base table creation
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
        except Exception as e:
            print(f"Base metadata create_all notice: {e}")

        # 2. Individual DDL migrations - each in its own transaction so one failure doesn't abort others
        migrations = [
            """CREATE TABLE IF NOT EXISTS merchant_voicebox (
                id UUID PRIMARY KEY,
                user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                is_active BOOLEAN DEFAULT FALSE,
                language VARCHAR(20) DEFAULT 'hi',
                activated_at TIMESTAMP WITH TIME ZONE,
                expires_at TIMESTAMP WITH TIME ZONE,
                target_settlement_vpa VARCHAR(50) DEFAULT 'rishabhraj1368@renopay',
                auto_announce_enabled BOOLEAN DEFAULT TRUE,
                announce_balance BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );""",
            """CREATE TABLE IF NOT EXISTS khatabook_customers (
                id UUID PRIMARY KEY,
                merchant_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name VARCHAR(120) NOT NULL,
                phone VARCHAR(20) NOT NULL,
                upi_id VARCHAR(80),
                email VARCHAR(120),
                address TEXT,
                net_balance_paise BIGINT DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );""",
            """CREATE TABLE IF NOT EXISTS khatabook_entries (
                id UUID PRIMARY KEY,
                customer_id UUID NOT NULL REFERENCES khatabook_customers(id) ON DELETE CASCADE,
                merchant_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                entry_type VARCHAR(10) NOT NULL,
                amount_paise BIGINT NOT NULL,
                items_description TEXT,
                entry_date DATE DEFAULT CURRENT_DATE,
                payment_mode VARCHAR(20) DEFAULT 'cash',
                renopay_txn_ref VARCHAR(64),
                voice_transcribed BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );""",
            # merchant_voicebox columns
            "ALTER TABLE merchant_voicebox ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();",
            "ALTER TABLE merchant_voicebox ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();",
            "ALTER TABLE merchant_voicebox ADD COLUMN IF NOT EXISTS language VARCHAR(20) DEFAULT 'hi';",
            "ALTER TABLE merchant_voicebox ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT FALSE;",
            "ALTER TABLE merchant_voicebox ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP WITH TIME ZONE;",
            "ALTER TABLE merchant_voicebox ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;",
            "ALTER TABLE merchant_voicebox ADD COLUMN IF NOT EXISTS target_settlement_vpa VARCHAR(50) DEFAULT 'rishabhraj1368@renopay';",
            "ALTER TABLE merchant_voicebox ADD COLUMN IF NOT EXISTS auto_announce_enabled BOOLEAN DEFAULT TRUE;",
            "ALTER TABLE merchant_voicebox ADD COLUMN IF NOT EXISTS announce_balance BOOLEAN DEFAULT TRUE;",
            # khatabook_customers columns
            "ALTER TABLE khatabook_customers ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();",
            "ALTER TABLE khatabook_customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();",
            "ALTER TABLE khatabook_customers ADD COLUMN IF NOT EXISTS upi_id VARCHAR(80);",
            "ALTER TABLE khatabook_customers ADD COLUMN IF NOT EXISTS email VARCHAR(120);",
            "ALTER TABLE khatabook_customers ADD COLUMN IF NOT EXISTS address TEXT;",
            "ALTER TABLE khatabook_customers ADD COLUMN IF NOT EXISTS net_balance_paise BIGINT DEFAULT 0;",
            # khatabook_entries columns
            "ALTER TABLE khatabook_entries ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();",
            "ALTER TABLE khatabook_entries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();",
            "ALTER TABLE khatabook_entries ADD COLUMN IF NOT EXISTS items_description TEXT;",
            "ALTER TABLE khatabook_entries ADD COLUMN IF NOT EXISTS entry_date DATE DEFAULT CURRENT_DATE;",
            "ALTER TABLE khatabook_entries ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(20) DEFAULT 'cash';",
            "ALTER TABLE khatabook_entries ADD COLUMN IF NOT EXISTS renopay_txn_ref VARCHAR(64);",
            "ALTER TABLE khatabook_entries ADD COLUMN IF NOT EXISTS voice_transcribed BOOLEAN DEFAULT FALSE;",
            # Other legacy tables
            "ALTER TABLE scratch_cards ADD COLUMN IF NOT EXISTS is_withdrawn BOOLEAN DEFAULT FALSE;",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS language_code VARCHAR(10) DEFAULT 'en';",
            "ALTER TABLE users ALTER COLUMN avatar_url TYPE TEXT;",
            "ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(20) DEFAULT 'normal';",
            # Update settlement VPA across voicebox and accounts
            "UPDATE merchant_voicebox SET target_settlement_vpa = 'rishabhraj1368@renopay' WHERE target_settlement_vpa IN ('927922878@renopay', '9279228578@renopay');",
            "UPDATE accounts SET vpa = 'rishabhraj1368@renopay' WHERE vpa IN ('927922878@renopay', '9279228578@renopay');",
        ]

        for ddl in migrations:
            try:
                async with engine.begin() as conn:
                    await conn.execute(text(ddl))
            except Exception:
                pass

        # Seed initial demo user if needed
        async with engine.connect() as conn:
            check = await conn.execute(text("SELECT 1 FROM information_schema.tables WHERE table_name = 'users' LIMIT 1;"))
            tables_exist = check.scalar() is not None

        if not tables_exist:
            async with AsyncSessionLocal() as session:
                res = await session.execute(select(User).where(User.phone_number == "9876543210"))
                existing_user = res.scalar_one_or_none()
                if not existing_user:
                    user = User(
                        full_name="Rishab Raj",
                        phone_number="9876543210",
                        email="rishab@example.com",
                        pin_hash=hash_pin("123456"),
                        kyc_status=KYCStatus.VERIFIED,
                    )
                    session.add(user)
                    await session.flush()
                    account = Account(
                        user_id=user.id,
                        virtual_acc_no=generate_virtual_acc_no(),
                        vpa="rishabhraj@renopay",
                        current_balance_paise=5000000,
                        upi_lite_balance_paise=100000,
                        digital_gold_paise=250000,
                    )
                    session.add(account)

                    user2 = User(
                        full_name="Alex Morgan",
                        phone_number="9876543211",
                        email="alex@example.com",
                        pin_hash=hash_pin("123456"),
                        kyc_status=KYCStatus.VERIFIED,
                    )
                    session.add(user2)
                    await session.flush()
                    account2 = Account(
                        user_id=user2.id,
                        virtual_acc_no=generate_virtual_acc_no(),
                        vpa="alex@renopay",
                        current_balance_paise=2500000,
                        upi_lite_balance_paise=50000,
                        digital_gold_paise=50000,
                    )
                    session.add(account2)
                    await session.commit()
        _db_initialized = True
    except Exception as e:
        print(f"init_db_if_needed warning: {e}")


async def get_db():
    """FastAPI dependency — yields a session, guarantees close."""
    if not _db_initialized:
        await init_db_if_needed()
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()

