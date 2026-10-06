"""
Importing every model here ensures Base.metadata is fully populated
before Alembic's autogenerate (or Base.metadata.create_all) runs.
Add new models to this list as you add feature modules.
"""
from app.models.user import User, Device, KYCStatus          # noqa: F401
from app.models.account import Account                        # noqa: F401
from app.models.transaction import (                           # noqa: F401
    Transaction, FraudEvent, TxnStatus, TxnType, TxnCategory,
)
from app.models.money_request import MoneyRequest, RequestStatus   # noqa: F401
from app.models.mandate import Mandate, MandateFrequency, MandateStatus  # noqa: F401
from app.models.reward import ScratchCard, RewardType          # noqa: F401
from app.models.savings import (                                # noqa: F401
    SavingsGoal, SharedVault, SharedVaultMember, SharedVaultLog, SharedVaultWithdrawalRequest,
)
from app.models.auth import RefreshToken                         # noqa: F401
from app.models.gold import UserGoldPot, GoldLedger              # noqa: F401
from app.models.accounting import (                             # noqa: F401
    ChartOfAccount, JournalEntry, JournalLine, LedgerAuditLog,
    Invoice, InvoiceStatus
)
from app.models.ai import AIConfig, AIChatSession, AIChatMessage  # noqa: F401
from app.models.travel import TravelBooking, TravelBookingType, TravelBookingStatus  # noqa: F401
from app.models.financial import Loan, Investment, BillPayment  # noqa: F401
from app.models.gift_card import GiftCard  # noqa: F401
from app.models.shopkeeper import (                             # noqa: F401
    MerchantVoiceBox, KhatabookCustomer, KhatabookEntry
)
