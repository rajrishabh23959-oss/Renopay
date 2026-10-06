"""
THE PAYMENT ENGINE.

This is the single, atomic code path every money movement in the app
goes through — manual payments, mandate auto-pay, bill-split payouts,
savings goal contributions, all of it. Nothing else is allowed to
mutate `accounts.current_balance_paise` directly.

Why this matters: if two requests try to spend the same balance at
the same instant (double-tap on the Pay button, or a genuine race
between two devices), naive read-then-write logic can let both
succeed and take the balance negative. We prevent that with
`SELECT ... FOR UPDATE`, which makes the second transaction wait for
the first to commit or roll back before it can even read the balance.
"""
import random
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.money import generate_txn_ref, new_txn_group_id
from app.models.account import Account
from app.models.reward import ScratchCard, RewardType
from app.models.transaction import Transaction, TxnType, TxnStatus, TxnCategory, FraudEvent
from app.models.user import User, Device
from app.services import sentinai
from app.services.pin_auth import verify_user_pin, PinError
from app.services import gold_service
from app.ws.manager import manager as ws_manager


class PaymentError(Exception):
    """Raised for any business-rule failure (insufficient funds, VPA
    not found, blocked by fraud engine, etc). Routers catch this and
    turn it into a clean 4xx response — the engine itself never
    returns partial success."""
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


@dataclass
class PaymentResult:
    txn_group_id: uuid.UUID
    txn_ref: str
    amount_paise: int
    round_up_paise: int
    sender_new_balance_paise: int
    trust_score: int
    risk_level: str


async def _lock_account(db: AsyncSession, account_id: uuid.UUID) -> Account:
    """SELECT ... FOR UPDATE — blocks concurrent transactions from
    reading this row until the current one commits/rolls back."""
    stmt = select(Account).where(Account.id == account_id).with_for_update()
    result = await db.execute(stmt)
    account = result.scalar_one_or_none()
    if account is None:
        raise PaymentError("account_not_found", "Account not found")
    return account


async def send_money(
    db: AsyncSession,
    *,
    sender_user_id: uuid.UUID,
    receiver_vpa: str,
    amount_paise: int,
    pin: str | None = None,
    description: str = "UPI Transfer",
    category: TxnCategory = TxnCategory.OTHER,
    device_fingerprint: str | None = None,
    current_lat: float | None = None,
    current_lng: float | None = None,
    note_slide_ms: int | None = None,
    note_count: int = 0,
    device_tilt_deg: float | None = None,
    skip_fraud_check: bool = False,
    skip_pin_check: bool = False,
    skip_round_up: bool = False,
    idempotency_key: str | None = None,
    use_upi_lite: bool = False,
    receiver_name: str | None = None,
) -> PaymentResult:
    if amount_paise <= 0:
        raise PaymentError("invalid_amount", "Amount must be greater than zero")
        
    from app.core.config import settings
    if use_upi_lite and amount_paise > settings.UPI_LITE_MAX_TXN_PAISE:
        from app.core.money import paise_to_rupees
        raise PaymentError("upi_lite_limit", f"UPI Lite limit exceeded (max {paise_to_rupees(settings.UPI_LITE_MAX_TXN_PAISE)})")

    # --- Fetch sender user + verify PIN FIRST, before touching any
    # account locks. This is deliberate: a wrong-PIN attempt should
    # fail fast and cheap, without holding row locks on either account.
    # skip_pin_check is only ever True for system-initiated transfers
    # (mandate auto-pay) where no human is present to type a PIN —
    # never for anything triggered directly by a user request. ---
    sender_user_result = await db.execute(select(User).where(User.id == sender_user_id))
    sender_user = sender_user_result.scalar_one_or_none()
    if sender_user is None:
        raise PaymentError("sender_not_found", "Sender not found")

    txn_group_id = new_txn_group_id()

    if idempotency_key:
        from app.models.transaction import IdempotencyKey
        from sqlalchemy.exc import IntegrityError

        # Attempt to insert immediately to reserve it and block concurrent duplicates
        db.add(IdempotencyKey(key=idempotency_key, user_id=sender_user_id, txn_group_id=txn_group_id))
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()
            # Idempotency replay: check if transaction was already completed
            existing_key_res = await db.execute(select(IdempotencyKey).where(IdempotencyKey.key == idempotency_key))
            existing_key = existing_key_res.scalar_one_or_none()
            if existing_key:
                existing_txn_res = await db.execute(
                    select(Transaction).where(
                        Transaction.txn_group_id == existing_key.txn_group_id,
                        Transaction.type == TxnType.DEBIT,
                    )
                )
                existing_txn = existing_txn_res.scalar_one_or_none()
                if existing_txn:
                    acc_res = await db.execute(select(Account).where(Account.user_id == sender_user_id))
                    acc = acc_res.scalar_one_or_none()
                    return PaymentResult(
                        txn_group_id=existing_key.txn_group_id,
                        txn_ref=existing_txn.txn_ref,
                        amount_paise=existing_txn.amount_paise,
                        round_up_paise=existing_txn.round_up_paise,
                        sender_new_balance_paise=acc.current_balance_paise if acc else 0,
                        trust_score=existing_txn.trust_score,
                        risk_level="low",
                    )
            raise PaymentError("idempotency_conflict", "Transaction is already being processed. Please check history.")

    if not skip_pin_check and not use_upi_lite:
        try:
            await verify_user_pin(db, sender_user, pin)
        except PinError as e:
            raise PaymentError(e.code, e.message)

    # --- Resolve account IDs first (no locks yet) ---
    sender_result = await db.execute(select(Account.id).where(Account.user_id == sender_user_id))
    sender_account_id = sender_result.scalar_one_or_none()
    if sender_account_id is None:
        raise PaymentError("sender_not_found", "Sender account not found")

    clean_receiver_vpa = receiver_vpa.strip().lower()
    receiver_result = await db.execute(select(Account.id).where(Account.vpa == clean_receiver_vpa))
    receiver_account_id = receiver_result.scalar_one_or_none()
    if receiver_account_id is None and clean_receiver_vpa in ("rishabhraj@renopay", "rishab@renopay", "rishabraj@renopay"):
        alt_res = await db.execute(
            select(Account.id).join(User, Account.user_id == User.id).where(
                (User.phone_number == "9876543210") | (Account.vpa.in_(["rishabhraj@renopay", "rishab@renopay"]))
            )
        )
        receiver_account_id = alt_res.scalar_one_or_none()
    if receiver_account_id is None:
        if "@" in clean_receiver_vpa:
            parts = clean_receiver_vpa.split("@")
            if len(parts) == 2 and parts[0] and parts[1]:
                from app.services.upi_directory import get_or_create_external_account
                ext_acc = await get_or_create_external_account(db, clean_receiver_vpa, receiver_name)
                receiver_account_id = ext_acc.id
            else:
                raise PaymentError("vpa_not_found", f"VPA not found: {receiver_vpa}")
        else:
            raise PaymentError("vpa_not_found", f"VPA not found: {receiver_vpa}")

    if receiver_account_id == sender_account_id:
        raise PaymentError("self_transfer", "Cannot send money to yourself")

    # --- Lock BOTH accounts in a fixed order (sorted by UUID string),
    # regardless of who is sender/receiver. This is what prevents
    # deadlocks: if payment A locks (X then Y) while payment B locks
    # (Y then X) concurrently, the two can deadlock each other. Always
    # locking in the same global order eliminates that possibility. ---
    first_id, second_id = sorted([sender_account_id, receiver_account_id], key=str)
    first_locked = await _lock_account(db, first_id)
    second_locked = await _lock_account(db, second_id)
    sender_account = first_locked if first_locked.id == sender_account_id else second_locked
    receiver_account = first_locked if first_locked.id == receiver_account_id else second_locked

    # --- Balance check ---
    if use_upi_lite:
        if sender_account.upi_lite_balance_paise < amount_paise:
            raise PaymentError("insufficient_balance", "Insufficient UPI Lite balance")
    else:
        if sender_account.current_balance_paise < amount_paise:
            raise PaymentError("insufficient_balance", "Insufficient balance")

    # --- Fraud check ---
    is_new_device = True
    if device_fingerprint:
        dev_result = await db.execute(
            select(Device).where(
                Device.user_id == sender_user_id,
                Device.device_fingerprint == device_fingerprint,
            )
        )
        device = dev_result.scalar_one_or_none()
        is_new_device = device is None or not device.is_trusted

    verdict = sentinai.analyze(
        amount_paise=amount_paise,
        is_new_device=is_new_device if not skip_fraud_check else False,
        last_lat=sender_user.last_lat,
        last_lng=sender_user.last_lng,
        last_location_at=sender_user.last_location_at,
        current_lat=current_lat,
        current_lng=current_lng,
        note_slide_ms=note_slide_ms,
        note_count=note_count,
        device_tilt_deg=device_tilt_deg,
    )

    db.add(FraudEvent(
        user_id=sender_user_id,
        txn_group_id=txn_group_id,
        risk_level=verdict.risk_level,
        risk_flags=",".join(verdict.risk_flags),
        explanations=" | ".join(verdict.explanations),
        trust_score=verdict.trust_score,
        blocked=verdict.blocked,
        amount_paise=amount_paise,
    ))

    if verdict.blocked and not skip_fraud_check:
        raise PaymentError("blocked_by_sentinai", "Blocked by SentinAI fraud detection")

    # --- Move the money ---
    if use_upi_lite:
        sender_account.upi_lite_balance_paise -= amount_paise
    else:
        orig_sender_bal = sender_account.current_balance_paise
        sender_account.current_balance_paise -= amount_paise
        amount_rupees = amount_paise // 100
        if amount_rupees > 0:
            from app.services.denomination_service import deduct_denominations
            sender_account.cash_denominations = deduct_denominations(
                sender_account.cash_denominations,
                amount_rupees,
                orig_sender_bal,
            )

    orig_receiver_bal = receiver_account.current_balance_paise
    receiver_account.current_balance_paise += amount_paise
    amount_rupees = amount_paise // 100
    if amount_rupees > 0:
        from app.services.denomination_service import add_denominations
        receiver_account.cash_denominations = add_denominations(
            receiver_account.cash_denominations,
            amount_rupees,
            orig_receiver_bal,
        )

    # --- Round-up to Digital Gold ---
    round_up_paise = 0
    gold_pot_info = {}
    if sender_account.round_up_enabled and not skip_round_up:
        rounded = ((amount_paise // 1000) + 1) * 1000 if amount_paise % 1000 else amount_paise
        round_up_paise = rounded - amount_paise
        if round_up_paise > 0 and sender_account.current_balance_paise >= round_up_paise:
            # Deduct spare change from wallet balance into the Gold Pot
            sender_account.current_balance_paise -= round_up_paise
            # Keep in UserGoldPot until full threshold (e.g. ₹200) triggers purchase
            gold_pot_info = await gold_service.execute_round_up(
                db, sender_user_id, round_up_paise
            )
            # When pot reaches threshold, pure gold purchase executes and credits digital gold balance
            if gold_pot_info.get("purchased"):
                sender_account.digital_gold_paise += gold_pot_info.get("purchase_amount_paise", 0)

    now = datetime.now(timezone.utc)

    # --- Reward: scratch card on qualifying transactions ---
    # Mirrors the mock's rule exactly: amount >= ₹500, ~40% chance.
    # Kept as a simple random roll rather than anything the sender can
    # predict or game; reward value/type also randomized within a range.
    if amount_paise >= 50_000 and random.random() > 0.6:
        if random.random() > 0.5:
            reward_type, reward_amount = RewardType.CASHBACK, random.randint(1000, 10000)
            label = f"₹{reward_amount // 100} Cashback"
        else:
            reward_type, reward_amount = RewardType.GOLD, random.randint(200, 2000)
            label = f"₹{reward_amount / 100:.2f} Digital Gold"
        db.add(ScratchCard(
            user_id=sender_user_id, reward_type=reward_type, reward_amount_paise=reward_amount,
            label=label, source_txn_group_id=txn_group_id,
            expires_at=now + timedelta(days=7),
        ))

    # --- Write ledger rows (double-entry: one debit, one credit) ---
    txn_ref = generate_txn_ref()

    debit_row = Transaction(
        txn_group_id=txn_group_id,
        txn_ref=txn_ref,
        account_id=sender_account.id,
        counterparty_vpa=receiver_account.vpa,
        type=TxnType.DEBIT,
        status=TxnStatus.SUCCESS,
        category=category,
        amount_paise=amount_paise,
        round_up_paise=round_up_paise,
        description=description,
        trust_score=verdict.trust_score,
        lat=current_lat, lng=current_lng,
        is_upi_lite=use_upi_lite,
    )
    credit_row = Transaction(
        txn_group_id=txn_group_id,
        txn_ref=generate_txn_ref(),
        account_id=receiver_account.id,
        counterparty_vpa=sender_account.vpa,
        type=TxnType.CREDIT,
        status=TxnStatus.SUCCESS,
        category=TxnCategory.INCOME,
        amount_paise=amount_paise,
        description=description,
        trust_score=99,
    )
    db.add_all([debit_row, credit_row])
    await db.flush()

    from app.services import accounting_engine
    await accounting_engine.post_transaction_to_journal(db, debit_row)
    await accounting_engine.post_transaction_to_journal(db, credit_row)

    # --- Generate reward scratch card if payment is ₹100 or more ---
    reward_card = None
    if amount_paise >= 10000:
        # Random percentage between 1% and 2%
        pct = random.uniform(0.01, 0.02)
        raw_reward = (amount_paise / 100.0) * pct
        # Clamped between ₹1.0 and ₹5.0 max with 1 decimal place (e.g. 1.2, 2.4, etc.)
        reward_rupees = round(min(5.0, max(1.0, raw_reward)), 1)
        reward_amount_paise = int(round(reward_rupees * 100))
        reward_card = ScratchCard(
            user_id=sender_user_id,
            reward_type=RewardType.CASHBACK,
            reward_amount_paise=reward_amount_paise,
            label=f"₹{reward_rupees:.1f} Cashback",
            source_txn_group_id=txn_group_id,
            expires_at=now + timedelta(days=30),
            scratched=False,
            is_withdrawn=False,
        )
        db.add(reward_card)

    # --- Update sender's last known location (for next txn's geo-velocity check) ---
    if current_lat is not None and current_lng is not None:
        sender_user.last_lat = current_lat
        sender_user.last_lng = current_lng
        sender_user.last_location_at = now

    # --- Khatabook Auto-Reconciliation for Receiver Merchant ---
    try:
        from app.models.shopkeeper import KhatabookCustomer, KhatabookEntry
        from sqlalchemy import or_
        khata_q = select(KhatabookCustomer).where(
            KhatabookCustomer.merchant_user_id == receiver_account.user_id,
            or_(
                KhatabookCustomer.upi_id == sender_account.vpa,
                KhatabookCustomer.phone == sender_user.phone_number,
            )
        )
        khata_res = await db.execute(khata_q)
        khata_cust = khata_res.scalar_one_or_none()
        if khata_cust:
            khata_cust.net_balance_paise -= amount_paise
            k_entry = KhatabookEntry(
                customer_id=khata_cust.id,
                merchant_user_id=receiver_account.user_id,
                entry_type="received",
                amount_paise=amount_paise,
                items_description=f"Auto-settled via RenoPay (Ref: {txn_ref})",
                entry_date=now.date(),
                payment_mode="renopay_upi",
                renopay_txn_ref=txn_ref,
            )
            db.add(k_entry)
    except Exception as e:
        logger.warning(f"Khatabook auto-reconcile notice: {e}")

    await db.commit()
    await db.refresh(sender_account)
    await db.refresh(receiver_account)

    if reward_card:
        await ws_manager.push(sender_account.user_id, "scratch_card_earned", {
            "card_id": str(reward_card.id),
            "label": reward_card.label,
            "reward_amount": reward_card.reward_amount_paise / 100,
        })

    # --- Push real-time updates to both parties' open sessions ---
    await ws_manager.push(sender_account.user_id, "balance_update", {
        "balance": sender_account.current_balance_paise / 100,
        "denominations": sender_account.cash_denominations,
        "digital_gold": sender_account.digital_gold_paise / 100,
        "reason": "debit", "txn_ref": txn_ref,
    })
    await ws_manager.push(receiver_account.user_id, "balance_update", {
        "balance": receiver_account.current_balance_paise / 100,
        "denominations": receiver_account.cash_denominations,
        "reason": "credit", "txn_ref": txn_ref,
    })

    # --- Real-Time Voice Box Audio Announcement for Receiver Merchant ---
    try:
        from app.models.shopkeeper import MerchantVoiceBox
        from app.routers.voicebox import build_announcement_text
        vb_res = await db.execute(
            select(MerchantVoiceBox).where(
                MerchantVoiceBox.user_id == receiver_account.user_id,
                MerchantVoiceBox.is_active == True,
            )
        )
        vb = vb_res.scalar_one_or_none()
        if vb and vb.expires_at and vb.expires_at > now:
            voice_text = build_announcement_text(
                vb.language,
                sender_name=sender_user.full_name or "Customer",
                amount=amount_paise / 100,
                current_balance=receiver_account.current_balance_paise / 100,
                include_balance=vb.announce_balance,
            )
            await ws_manager.push(receiver_account.user_id, "voicebox_announcement", {
                "text": voice_text,
                "amount": amount_paise / 100,
                "sender_name": sender_user.full_name or "Customer",
                "language": vb.language,
                "balance": receiver_account.current_balance_paise / 100,
                "txn_ref": txn_ref,
            })
    except Exception as e:
        logger.warning(f"Voicebox trigger notice: {e}")

    # Push gold pot update if round-up happened
    if gold_pot_info:
        await ws_manager.push(sender_account.user_id, "gold_pot_update", {
            "pot_balance": gold_pot_info["pot_balance"],
            "pot_balance_paise": gold_pot_info["pot_balance_paise"],
            "pot_progress_pct": round(
                min(100, (gold_pot_info["pot_balance_paise"] / gold_service.PURCHASE_THRESHOLD_PAISE) * 100), 1
            ),
            "purchased": gold_pot_info["purchased"],
            "grams_bought": gold_pot_info["grams_bought"],
        })

    return PaymentResult(
        txn_group_id=txn_group_id,
        txn_ref=txn_ref,
        amount_paise=amount_paise,
        round_up_paise=round_up_paise,
        sender_new_balance_paise=sender_account.current_balance_paise,
        trust_score=verdict.trust_score,
        risk_level=verdict.risk_level,
    )
