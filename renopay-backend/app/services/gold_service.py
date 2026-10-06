"""
Gold Round-Up Service.

Every time a debit transaction fires, the payment engine calls
execute_round_up() with the round_up_paise amount. This service:

1. Upserts a UserGoldPot for the user.
2. Adds the spare-change to the pot.
3. If pot crosses PURCHASE_THRESHOLD_PAISE (20000 = Rs.200):
   - Calculates simulated gold grams (at GOLD_RATE_PER_GRAM_PAISE).
   - Writes an immutable GoldLedger row.
   - Resets the pot balance to 0.
   - Returns True (caller pushes WS event).

TODO: Replace the simulated buy with a real call to Augmont / SafeGold API:
    response = await httpx.post(
        "https://api.augmont.com/v1/buy",
        json={"amount": pot_balance_in_rupees, "user_id": str(user_id)},
        headers={"Authorization": f"Bearer {settings.AUGMONT_API_KEY}"},
    )
"""
import uuid
import logging
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.gold import UserGoldPot, GoldLedger

logger = logging.getLogger("renopay.gold")

# Rs. 200 threshold before a bulk gold purchase fires
PURCHASE_THRESHOLD_PAISE: int = 20_000
# Simulated gold rate: Rs. 5000 per gram (proxy; swap with live price feed)
GOLD_RATE_PER_GRAM_PAISE: int = 500_000


async def get_or_create_pot(db: AsyncSession, user_id: uuid.UUID) -> UserGoldPot:
    result = await db.execute(select(UserGoldPot).where(UserGoldPot.user_id == user_id))
    pot = result.scalar_one_or_none()
    if pot is None:
        pot = UserGoldPot(user_id=user_id, balance_paise=0, total_accumulated_paise=0)
        db.add(pot)
        await db.flush()  # get pot.id without committing
    return pot


async def execute_round_up(
    db: AsyncSession,
    user_id: uuid.UUID,
    round_up_paise: int,
    source: str = "round_up",
) -> dict:
    """
    Add round_up_paise to the user's pot.
    Returns a dict with the current pot state and whether a purchase fired.
    """
    if round_up_paise <= 0:
        return {"purchased": False, "pot_balance": 0}

    pot = await get_or_create_pot(db, user_id)
    pot.balance_paise += round_up_paise
    pot.total_accumulated_paise += round_up_paise

    purchased = False
    grams_bought = 0.0
    purchase_amount_paise = 0

    if pot.balance_paise >= PURCHASE_THRESHOLD_PAISE:
        purchase_amount_paise = pot.balance_paise
        grams_bought = float(
            Decimal(str(purchase_amount_paise)) / Decimal(str(GOLD_RATE_PER_GRAM_PAISE))
        )
        ledger = GoldLedger(
            pot_id=pot.id,
            user_id=user_id,
            amount_paise=purchase_amount_paise,
            grams_equivalent=grams_bought,
            source=source,
        )
        db.add(ledger)
        pot.balance_paise = 0
        purchased = True
        logger.info(
            f"Gold purchase for user {user_id}: Rs.{purchase_amount_paise / 100:.2f} "
            f"= {grams_bought:.4f} g (simulated)"
        )

    return {
        "purchased": purchased,
        "pot_balance_paise": pot.balance_paise,
        "pot_balance": pot.balance_paise / 100,
        "total_accumulated": pot.total_accumulated_paise / 100,
        "grams_bought": grams_bought,
        "purchase_amount": purchase_amount_paise / 100,
        "purchase_amount_paise": purchase_amount_paise,
    }


async def get_gold_summary(db: AsyncSession, user_id: uuid.UUID) -> dict:
    """Return the full gold dashboard payload for a user."""
    pot = await get_or_create_pot(db, user_id)

    ledger_result = await db.execute(
        select(GoldLedger)
        .where(GoldLedger.user_id == user_id)
        .order_by(GoldLedger.created_at.desc())
        .limit(20)
    )
    entries = ledger_result.scalars().all()

    total_grams = sum(float(e.grams_equivalent) for e in entries)

    return {
        "pot_balance": pot.balance_paise / 100,
        "pot_balance_paise": pot.balance_paise,
        "total_accumulated": pot.total_accumulated_paise / 100,
        "threshold": PURCHASE_THRESHOLD_PAISE / 100,  # Rs.200
        "threshold_paise": PURCHASE_THRESHOLD_PAISE,
        "pot_progress_pct": round(min(100, (pot.balance_paise / PURCHASE_THRESHOLD_PAISE) * 100), 1),
        "total_grams": round(total_grams, 4),
        "gold_rate_per_gram": GOLD_RATE_PER_GRAM_PAISE / 100,
        "ledger": [
            {
                "id": str(e.id),
                "amount": e.amount_paise / 100,
                "grams": float(e.grams_equivalent),
                "source": e.source,
                "created_at": e.created_at.isoformat(),
            }
            for e in entries
        ],
    }
