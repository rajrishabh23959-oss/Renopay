"""
RenoPay Merchant Smart Voice Box Router.
Provides:
1. Subscription Management (₹200 for 6 months, ₹100 for language change, ₹200 renewal).
2. Routing payments to RenoPay official settlement account: rishabhraj1368@renopay.
3. Regional Language Text-to-Speech announcement formatting (Hindi, English, Tamil, Telugu, Malayalam, etc.).
4. Auto-announcement preferences and status checks.
"""
import uuid
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User, KYCStatus
from app.models.account import Account
from app.models.shopkeeper import MerchantVoiceBox
from app.models.transaction import Transaction, TxnStatus, TxnType, TxnCategory
from app.core.money import generate_virtual_acc_no, generate_txn_ref

router = APIRouter()

_voicebox_columns_checked = False

async def _ensure_voicebox_columns(db: AsyncSession, force: bool = False):
    global _voicebox_columns_checked
    if _voicebox_columns_checked and not force:
        return
    ddls = [
        "ALTER TABLE merchant_voicebox ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();",
        "ALTER TABLE merchant_voicebox ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();",
        "ALTER TABLE merchant_voicebox ADD COLUMN IF NOT EXISTS language VARCHAR(20) DEFAULT 'hi';",
        "ALTER TABLE merchant_voicebox ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT FALSE;",
        "ALTER TABLE merchant_voicebox ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP WITH TIME ZONE;",
        "ALTER TABLE merchant_voicebox ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;",
        "ALTER TABLE merchant_voicebox ADD COLUMN IF NOT EXISTS target_settlement_vpa VARCHAR(50) DEFAULT 'rishabhraj1368@renopay';",
        "ALTER TABLE merchant_voicebox ADD COLUMN IF NOT EXISTS auto_announce_enabled BOOLEAN DEFAULT TRUE;",
        "ALTER TABLE merchant_voicebox ADD COLUMN IF NOT EXISTS announce_balance BOOLEAN DEFAULT TRUE;",
    ]
    for ddl in ddls:
        try:
            await db.execute(text(ddl))
            await db.commit()
        except Exception:
            await db.rollback()
    _voicebox_columns_checked = True


async def _get_or_repair_voicebox(db: AsyncSession, user_id: uuid.UUID) -> MerchantVoiceBox | None:
    try:
        await _ensure_voicebox_columns(db)
        res = await db.execute(select(MerchantVoiceBox).where(MerchantVoiceBox.user_id == user_id))
        return res.scalar_one_or_none()
    except Exception as exc:
        err_str = str(exc).lower()
        if any(w in err_str for w in ["does not exist", "undefined_column", "column", "programmingerror"]):
            await db.rollback()
            await _ensure_voicebox_columns(db, force=True)
            res = await db.execute(select(MerchantVoiceBox).where(MerchantVoiceBox.user_id == user_id))
            return res.scalar_one_or_none()
        raise

VOICEBOX_ACTIVATION_FEE_PAISE = 20_000   # ₹200 (6 months validity)
VOICEBOX_LANG_CHANGE_FEE_PAISE = 10_000  # ₹100
VOICEBOX_RENEWAL_FEE_PAISE = 20_000      # ₹200
OFFICIAL_SETTLEMENT_PHONE = "9279228578"
OFFICIAL_SETTLEMENT_VPA = "rishabhraj1368@renopay"
OFFICIAL_SETTLEMENT_NAME = "Rishabh Raj"

LANGUAGE_LABELS = {
    "hi": "हिन्दी (Hindi)",
    "en": "English",
    "ta": "தமிழ் (Tamil)",
    "te": "తెలుగు (Telugu)",
    "ml": "മലയാളം (Malayalam)",
    "kn": "ಕನ್ನಡ (Kannada)",
    "mr": "मराठी (Marathi)",
    "bn": "বাংলা (Bengali)",
    "gu": "ગુજરાતી (Gujarati)",
    "pa": "ਪੰਜਾਬੀ (Punjabi)",
    "bho": "भोजपुरी (Bhojpuri)",
    "or": "ଓଡ଼ିଆ (Odia)",
}


class ActivateVoiceBoxRequest(BaseModel):
    language: str = Field(default="hi", description="Language code e.g. hi, en, mr, etc.")


class ChangeLanguageRequest(BaseModel):
    language: str = Field(min_length=2, description="Target language code")


class ToggleSettingsRequest(BaseModel):
    auto_announce_enabled: bool | None = None
    announce_balance: bool | None = None


class SampleAnnouncementRequest(BaseModel):
    sender_name: str = "rishabh"
    amount: float = 100.0
    language: str | None = None


async def _get_or_create_settlement_account(db: AsyncSession) -> Account:
    """Finds or initializes the official central settlement account for rishabhraj1368@renopay."""
    res = await db.execute(select(Account).where(Account.vpa == OFFICIAL_SETTLEMENT_VPA))
    acc = res.scalar_one_or_none()
    if acc:
        return acc

    # Migrate any existing account with old VPA
    for old_vpa in ["927922878@renopay", "9279228578@renopay"]:
        old_acc_res = await db.execute(select(Account).where(Account.vpa == old_vpa))
        old_acc = old_acc_res.scalar_one_or_none()
        if old_acc:
            old_acc.vpa = OFFICIAL_SETTLEMENT_VPA
            await db.flush()
            return old_acc

    user_res = await db.execute(
        select(User).where(
            (User.phone_number == OFFICIAL_SETTLEMENT_PHONE) |
            (User.email == "rishabhraj1368@renopay.in") |
            (User.phone_number == "927922878")
        )
    )
    settle_user = user_res.scalar_one_or_none()
    if not settle_user:
        from app.core.security import hash_pin
        settle_user = User(
            phone_number=OFFICIAL_SETTLEMENT_PHONE,
            full_name=OFFICIAL_SETTLEMENT_NAME,
            email="rishabhraj1368@renopay.in",
            pin_hash=hash_pin("123456"),
            kyc_status=KYCStatus.VERIFIED,
        )
        db.add(settle_user)
        await db.flush()

    user_acc_res = await db.execute(select(Account).where(Account.user_id == settle_user.id))
    acc = user_acc_res.scalar_one_or_none()
    if acc:
        acc.vpa = OFFICIAL_SETTLEMENT_VPA
        await db.flush()
        return acc

    acc = Account(
        user_id=settle_user.id,
        virtual_acc_no=generate_virtual_acc_no(),
        vpa=OFFICIAL_SETTLEMENT_VPA,
        current_balance_paise=0,
    )
    db.add(acc)
    await db.flush()
    return acc


def build_announcement_text(language: str, sender_name: str, amount: float, current_balance: float | None = None, include_balance: bool = True) -> str:
    """Generates localized announcement text for the speech synthesis engine."""
    amt_str = f"{int(amount) if amount.is_integer() else f'{amount:.2f}'}"
    bal_str = f"₹{current_balance:,.0f}" if current_balance is not None else ""

    if language == "hi":
        txt = f"RenoPay par {sender_name} se {amt_str} rupaye prapt hue."
        if include_balance and bal_str:
            txt += f" Kul bachaat {bal_str} rupaye."
        return txt
    elif language == "bho":
        txt = f"RenoPay par {sender_name} se {amt_str} rupya milal ba."
        if include_balance and bal_str:
            txt += f" Kul bachaat {bal_str} rupya ba."
        return txt
    elif language == "mr":
        txt = f"RenoPay var {sender_name} kadun {amt_str} rupaye prapta jhale."
        if include_balance and bal_str:
            txt += f" Ekun balance {bal_str} rupaye."
        return txt
    elif language == "bn":
        txt = f"RenoPay te {sender_name} er theke {amt_str} taka pawa geche."
        if include_balance and bal_str:
            txt += f" Mot balance {bal_str} taka."
        return txt
    elif language == "ta":
        txt = f"RenoPay-il {sender_name}-idamirundhu {amt_str} rubai perappattadhu."
        if include_balance and bal_str:
            txt += f" Motha balance {bal_str} rubai."
        return txt
    elif language == "te":
        txt = f"RenoPay lo {sender_name} nundi {amt_str} rupayalu andukunnam."
        if include_balance and bal_str:
            txt += f" Mothan balance {bal_str} rupayalu."
        return txt
    elif language == "ml":
        txt = f"RenoPay-il {sender_name}-il ninnu {amt_str} roopa labhichu."
        if include_balance and bal_str:
            txt += f" Aake balance {bal_str} roopa."
        return txt
    elif language == "kn":
        txt = f"RenoPay nalli {sender_name} avarinda {amt_str} rupayi sweekarislagide."
        if include_balance and bal_str:
            txt += f" Ootu balance {bal_str} rupayi."
        return txt
    elif language == "gu":
        txt = f"RenoPay par {sender_name} tarafthi {amt_str} rupiya malya."
        if include_balance and bal_str:
            txt += f" Kul balance {bal_str} rupiya."
        return txt
    elif language == "pa":
        txt = f"RenoPay utte {sender_name} valon {amt_str} rupaye prapat hoye."
        if include_balance and bal_str:
            txt += f" Kul balance {bal_str} rupaye."
        return txt
    elif language == "or":
        txt = f"RenoPay re {sender_name} nka tharu {amt_str} tanka prapta hela."
        if include_balance and bal_str:
            txt += f" Mot balance {bal_str} tanka."
        return txt
    else:  # en
        txt = f"Received {amt_str} rupees from {sender_name} on RenoPay."
        if include_balance and bal_str:
            txt += f" Total balance {bal_str}."
        return txt


@router.get("/status")
async def get_voicebox_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Fetch current merchant voice box subscription status."""
    vb = await _get_or_repair_voicebox(db, user.id)

    now = datetime.now(timezone.utc)
    is_active = False
    days_remaining = 0

    if vb and vb.is_active and vb.expires_at:
        if vb.expires_at > now:
            is_active = True
            days_remaining = (vb.expires_at - now).days
        else:
            vb.is_active = False
            await db.commit()

    return {
        "is_active": is_active,
        "language": vb.language if vb else "hi",
        "language_label": LANGUAGE_LABELS.get(vb.language if vb else "hi", "हिन्दी (Hindi)"),
        "activated_at": vb.activated_at.isoformat() if vb and vb.activated_at else None,
        "expires_at": vb.expires_at.isoformat() if vb and vb.expires_at else None,
        "days_remaining": days_remaining,
        "auto_announce_enabled": vb.auto_announce_enabled if vb else True,
        "announce_balance": vb.announce_balance if vb else True,
        "target_settlement_vpa": OFFICIAL_SETTLEMENT_VPA,
        "activation_fee": VOICEBOX_ACTIVATION_FEE_PAISE / 100,
        "lang_change_fee": VOICEBOX_LANG_CHANGE_FEE_PAISE / 100,
        "available_languages": [
            {"code": k, "label": v} for k, v in LANGUAGE_LABELS.items()
        ],
    }


@router.post("/activate")
async def activate_voicebox(
    payload: ActivateVoiceBoxRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Activate Smart Voice Box for ₹200 (6 months validity).
    Fee is routed directly to the RenoPay account linked with rishabhraj1368@renopay.
    """
    acc_res = await db.execute(select(Account).where(Account.user_id == user.id))
    user_account = acc_res.scalar_one_or_none()
    if not user_account:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User account not found")

    if user_account.current_balance_paise < VOICEBOX_ACTIVATION_FEE_PAISE:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Insufficient balance. Voice Box activation requires ₹{VOICEBOX_ACTIVATION_FEE_PAISE / 100:.0f}."
        )

    # 1. Debit user
    user_account.current_balance_paise -= VOICEBOX_ACTIVATION_FEE_PAISE

    # 2. Credit official central settlement account (rishabhraj1368@renopay)
    settle_acc = await _get_or_create_settlement_account(db)
    settle_acc.current_balance_paise += VOICEBOX_ACTIVATION_FEE_PAISE

    # 3. Record Audit Transaction
    txn_ref = generate_txn_ref()
    txn = Transaction(
        txn_group_id=uuid.uuid4(),
        txn_ref=txn_ref,
        account_id=user_account.id,
        counterparty_vpa=OFFICIAL_SETTLEMENT_VPA,
        counterparty_name="Rishabh Raj (RenoPay Voice Box)",
        amount_paise=VOICEBOX_ACTIVATION_FEE_PAISE,
        type=TxnType.DEBIT,
        status=TxnStatus.SUCCESS,
        category=TxnCategory.BILLS,
        description=f"RenoPay Smart Voice Box 6-Month Plan ({payload.language.upper()})",
        trust_score=99,
    )
    db.add(txn)

    # 4. Upsert MerchantVoiceBox record
    now = datetime.now(timezone.utc)
    vb = await _get_or_repair_voicebox(db, user.id)
    if not vb:
        vb = MerchantVoiceBox(
            user_id=user.id,
            is_active=True,
            language=payload.language,
            activated_at=now,
            expires_at=now + timedelta(days=180),
            target_settlement_vpa=OFFICIAL_SETTLEMENT_VPA,
        )
        db.add(vb)
    else:
        vb.is_active = True
        vb.language = payload.language
        vb.activated_at = now
        vb.expires_at = now + timedelta(days=180)

    await db.commit()

    sample_announcement = build_announcement_text(
        payload.language,
        sender_name="rishabh",
        amount=100.0,
        current_balance=user_account.current_balance_paise / 100,
    )

    return {
        "success": True,
        "message": "RenoPay Smart Voice Box activated successfully for 6 months!",
        "language": vb.language,
        "expires_at": vb.expires_at.isoformat(),
        "sample_announcement": sample_announcement,
        "settled_to": OFFICIAL_SETTLEMENT_VPA,
    }


@router.post("/change-language")
async def change_voicebox_language(
    payload: ChangeLanguageRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Switch Voice Box announcement language for ₹100 fee routed to rishabhraj1368@renopay.
    """
    vb = await _get_or_repair_voicebox(db, user.id)
    if not vb or not vb.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No active Voice Box subscription found. Please activate first.")

    if vb.language == payload.language:
        return {"success": True, "message": "Voice Box is already set to this language.", "language": vb.language}

    acc_res = await db.execute(select(Account).where(Account.user_id == user.id))
    user_account = acc_res.scalar_one_or_none()
    if not user_account or user_account.current_balance_paise < VOICEBOX_LANG_CHANGE_FEE_PAISE:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Insufficient balance. Changing language costs ₹{VOICEBOX_LANG_CHANGE_FEE_PAISE / 100:.0f}."
        )

    # 1. Debit user ₹100
    user_account.current_balance_paise -= VOICEBOX_LANG_CHANGE_FEE_PAISE

    # 2. Credit official settlement account
    settle_acc = await _get_or_create_settlement_account(db)
    settle_acc.current_balance_paise += VOICEBOX_LANG_CHANGE_FEE_PAISE

    # 3. Transaction record
    txn = Transaction(
        txn_group_id=uuid.uuid4(),
        txn_ref=generate_txn_ref(),
        account_id=user_account.id,
        counterparty_vpa=OFFICIAL_SETTLEMENT_VPA,
        counterparty_name="Rishabh Raj (RenoPay Voice Box)",
        amount_paise=VOICEBOX_LANG_CHANGE_FEE_PAISE,
        type=TxnType.DEBIT,
        status=TxnStatus.SUCCESS,
        category=TxnCategory.BILLS,
        description=f"Voice Box Language Switch to {payload.language.upper()}",
        trust_score=99,
    )
    db.add(txn)

    # 4. Update language
    vb.language = payload.language
    await db.commit()

    sample = build_announcement_text(
        payload.language,
        sender_name="rishabh",
        amount=100.0,
        current_balance=user_account.current_balance_paise / 100,
    )

    return {
        "success": True,
        "message": f"Language changed to {LANGUAGE_LABELS.get(payload.language, payload.language)} successfully!",
        "language": vb.language,
        "sample_announcement": sample,
    }


@router.post("/renew")
async def renew_voicebox(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Renew Voice Box for another 6 months for ₹200 fee routed to rishabhraj1368@renopay.
    """
    vb = await _get_or_repair_voicebox(db, user.id)
    if not vb:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Please activate Voice Box first.")

    acc_res = await db.execute(select(Account).where(Account.user_id == user.id))
    user_account = acc_res.scalar_one_or_none()
    if not user_account or user_account.current_balance_paise < VOICEBOX_RENEWAL_FEE_PAISE:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Insufficient balance. Renewal requires ₹{VOICEBOX_RENEWAL_FEE_PAISE / 100:.0f}."
        )

    # 1. Debit user ₹200
    user_account.current_balance_paise -= VOICEBOX_RENEWAL_FEE_PAISE

    # 2. Credit settlement
    settle_acc = await _get_or_create_settlement_account(db)
    settle_acc.current_balance_paise += VOICEBOX_RENEWAL_FEE_PAISE

    # 3. Transaction
    txn = Transaction(
        txn_group_id=uuid.uuid4(),
        txn_ref=generate_txn_ref(),
        account_id=user_account.id,
        counterparty_vpa=OFFICIAL_SETTLEMENT_VPA,
        counterparty_name="Rishabh Raj (RenoPay Voice Box)",
        amount_paise=VOICEBOX_RENEWAL_FEE_PAISE,
        type=TxnType.DEBIT,
        status=TxnStatus.SUCCESS,
        category=TxnCategory.BILLS,
        description="RenoPay Voice Box 6-Month Renewal",
        trust_score=99,
    )
    db.add(txn)

    # 4. Extend expiry
    now = datetime.now(timezone.utc)
    base_time = vb.expires_at if (vb.expires_at and vb.expires_at > now) else now
    vb.expires_at = base_time + timedelta(days=180)
    vb.is_active = True
    await db.commit()

    return {
        "success": True,
        "message": "Voice Box renewed for an additional 6 months!",
        "expires_at": vb.expires_at.isoformat(),
        "days_remaining": (vb.expires_at - now).days,
    }


@router.post("/toggle-settings")
async def toggle_settings(
    payload: ToggleSettingsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Toggle announcement preferences."""
    vb = await _get_or_repair_voicebox(db, user.id)
    if not vb:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Voice box not found")

    if payload.auto_announce_enabled is not None:
        vb.auto_announce_enabled = payload.auto_announce_enabled
    if payload.announce_balance is not None:
        vb.announce_balance = payload.announce_balance

    await db.commit()
    return {
        "success": True,
        "auto_announce_enabled": vb.auto_announce_enabled,
        "announce_balance": vb.announce_balance,
    }


@router.post("/sample-announcement")
async def sample_announcement(
    payload: SampleAnnouncementRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate audio text for test preview."""
    vb = await _get_or_repair_voicebox(db, user.id)
    lang = payload.language or (vb.language if vb else "hi")

    acc_res = await db.execute(select(Account).where(Account.user_id == user.id))
    acc = acc_res.scalar_one_or_none()
    balance = (acc.current_balance_paise / 100) if acc else 5000.0

    announcement_text = build_announcement_text(
        lang,
        sender_name=payload.sender_name,
        amount=payload.amount,
        current_balance=balance,
        include_balance=vb.announce_balance if vb else True,
    )

    return {
        "language": lang,
        "text": announcement_text,
    }
