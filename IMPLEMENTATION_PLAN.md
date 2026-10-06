# RenoPay: Merchant & Shopkeeper Ecosystem Implementation Plan

> **Document Version:** 1.0.0  
> **Target Platform:** RenoPay Full-Stack Platform (FastAPI + React + PostgreSQL/SQLite + WebSockets)  
> **Status:** Approved for Implementation  

---

## 1. Executive Summary & Objective

This document outlines the end-to-end technical blueprint for introducing **Dual Merchant Modes** inside RenoPay, creating a dedicated **Shopkeeper Mode (दुकानदार / रिटेल मोड)** alongside the existing **Enterprise Accounting Engine**, integrating a **Smart Virtual Voice Box (आवाज बॉक्स)**, a complete **Digital Khatabook (डिजिटल बही-खाता)** with **Saathi AI Voice-Assisted Entry**, **Automated UPI Reconciliation**, **Monthly PDF Reports**, and fixing the **Digital Gold Round-Up Pot Engine**.

```
                                  ┌────────────────────────────────┐
                                  │      Accounting / Merchant     │
                                  └───────────────┬────────────────┘
                                                  │
                 ┌────────────────────────────────┴────────────────────────────────┐
                 ▼                                                                 ▼
   ┌─────────────────────────────┐                                   ┌─────────────────────────────┐
   │ 1. Corporate Accounting     │                                   │ 2. Shopkeeper Mode          │
   │    (Enterprise Mode)        │                                   │    (दुकानदार / मर्चेंट मोड) │
   ├─────────────────────────────┤                                   ├─────────────────────────────┤
   │ • Double-Entry Journals     │                                   │ Pillar A: Smart Voice Box   │
   │ • Chart of Accounts (COA)   │                                   │ • ₹200 / 6 mo activation    │
   │ • General & Payee Ledgers   │                                   │ • Regional TTS speech       │
   │ • Trial Balance & P&L       │                                   │ • Paid to 927922878 account │
   │ • Balance Sheet & Cashflow  │                                   │                             │
   │ • GST & Payroll Engine      │                                   │ Pillar B: Digital Khatabook │
   │ • Full Accounting Pack PDF  │                                   │ • Udhar / Jama Ledgers      │
   └─────────────────────────────┘                                   │ • 1-Tap UPI Request & Sync  │
                                                                     │ • Saathi AI Voice Entry Mic │
                                                                     │ • Customer Statement PDF    │
                                                                     │ • Full Month Sales PDF      │
                                                                     └─────────────────────────────┘
```

---

## 2. Core Functional Requirements Breakdown

### 2.1 Mode Separation (Accounting vs. Shopkeeper)
- In the navigation bar and accounting screen, merchants can toggle between:
  1. **Corporate Accounting Mode**: The established double-entry bookkeeping suite (Journal, COA, General Ledger, Payee Ledger, Trial Balance, P&L, Balance Sheet, Cash Flow, GST, Payroll, Invoices, Full Pack PDF).
  2. **Shopkeeper Mode**: Tailored for daily retail merchants, kirana stores, and MSMEs, featuring two primary pillars:
     - **Pillar 1: Smart Voice Box (आवाज बॉक्स)**
     - **Pillar 2: Digital Khatabook (डिजिटल बही-खाता)**

---

### 2.2 Pillar 1: Smart Voice Box (आवाज बॉक्स / RenoPay Soundbox)

#### A. Commercials & Subscription Lifecycle
1. **Activation Fee:** ₹200 for 6 months validity.
2. **Language Selection:** Chosen at activation (Hindi, English, Hinglish, Marathi, Bengali, Tamil, Telugu, Kannada, Gujarati, Bhojpuri, etc.) at no extra charge.
3. **Language Change Fee:** ₹100 per language switch.
4. **Renewal Fee:** ₹200 every 6 months.
5. **Central Payment Routing:** All subscription and language change payments route directly to RenoPay's central account registered with mobile number **`927922878`** (`927922878@renopay` / RenoPay Official Settlement VPA).

#### B. Voice Announcement & Audio Engine
1. **Real-time Trigger:** Incoming payment received via WebSocket (`payment_received` / `balance_update`).
2. **Spoken Announcement Format:**
   > *"RenoPay par Praveen se 100 rupaye prapt hue. Kul balance ₹5,420."*  
   > *(Regional equivalent in selected language, e.g., Hindi, English, Bhojpuri, Marathi, etc.)*
3. **Sound Output:** Authentic payment chime followed by Web Speech Synthesis / Regional TTS audio through the phone speaker.
4. **Interactive Soundbox UI:**
   - 3D speaker graphic with audio wave visualizer.
   - Subscription countdown pill (*"Active · 174 days remaining"*).
   - "Test Voice Announcement" button.
   - Volume slider & announcement history log.

---

### 2.3 Pillar 2: Digital Khatabook (डिजिटल बही-खाता)

#### A. Customer Onboarding
- **Mandatory Fields:** Full Name, 10-digit Phone Number.
- **Optional Fields:** UPI ID (e.g. `9876543210@upi`), Email address, Store note/Address.
- Instant search by name/phone, filtering by overdue balance, sorting by highest balance.

#### B. Udhar & Jama Transactions (Maine Diye / Maine Liye)
- **Maine Diye (You Gave / Udhar):** Amount (₹), Itemized purchase description (e.g., *"2kg Basmati Rice, 1L Mustard Oil"*), Date & time picker.
- **Maine Liye (You Received / Jama):** Amount (₹), Mode (Cash, RenoPay UPI, Bank transfer), Date.
- Real-time calculation of net balance:
  - *You Will Get (आपको मिलेंगे)*: Green/Red indicator.
  - *You Will Give (आपको देने हैं)*: Advance payment balance.

#### C. Instant RenoPay UPI Request & Automatic Ledger Reconciliation
- Single-tap **"Request Payment via RenoPay"** sends a collect request to the customer.
- **Automated Settlement Sync:**
  1. Customer pays the collect request via RenoPay.
  2. Transaction settles to merchant's RenoPay account.
  3. System automatically inserts a `"Maine Liye (RenoPay UPI)"` entry into that customer's Khatabook ledger.
  4. Deducts the amount from customer's outstanding balance without manual intervention.
  5. Voice Box simultaneously announces the received payment!

#### D. Saathi AI Voice-Assisted Entry (बोलकर खाता में एंट्री)
- Dedicated microphone button in Khatabook header.
- Merchant speaks natural Hindi/Hinglish instructions:
  > *"Aaj Ramesh ko 200 rupaye diye 2 kilo chawal aur tel ke liye"*  
  > *"Praveen se 500 rupaye jama mile"*
- **Saathi AI NLP Parser:**
  - Extracts Intent (`GAVE` or `RECEIVED`).
  - Extracts Amount (`₹200`).
  - Extracts Customer Name (`Ramesh`) and auto-links with existing customer profile.
  - Extracts Bill Description (`"2 kilo chawal aur tel"`).
- Displays immediate confirmation card and records the entry without manual typing.

#### E. Voice Calling AI Agent (Roadmap)
- Architecture placeholder for automated AI reminder calls to customers with pending balances.

#### F. Customer Monthly Statement PDF & 1-Click Share
- Inside each customer's account:
  - Complete date-wise itemized ledger of items bought and payments made.
  - **View PDF** & **Download PDF** actions.
  - **1-Click Share** (WhatsApp / SMS / RenoPay message) with detailed itemized breakdown.

#### G. Full Month Sales & Business PDF Report
- Top summary banner inside Shopkeeper Mode:
  - Total Monthly Business Sales (Turnover).
  - Total Udhar Given vs. Total Udhar Recovered.
  - Net Outstanding Balance.
  - Cash vs. RenoPay UPI breakdown.
  - Week-wise sales progress (Week 1, Week 2, Week 3, Week 4).
  - Date-wise transaction ledger.
  - Dedicated **View PDF** and **Download PDF** buttons.

---

### 2.4 Digital Gold Round-Up & Pot Engine Fix

#### Current Issue Diagnosed:
In `payment_engine.py:274-275`:
```python
sender_account.current_balance_paise -= round_up_paise
sender_account.digital_gold_paise += round_up_paise # BUG: Direct instant gold credit!
gold_pot_info = await gold_service.execute_round_up(db, sender_user_id, round_up_paise)
```
Crediting `digital_gold_paise` immediately on every transaction bypasses the Gullak/Pot threshold concept and creates duplicate/inconsistent state with `UserGoldPot`.

#### Corrected Architecture:
1. **Accumulate in Pot First:**
   - Transaction of ₹42 is rounded to ₹50 (difference: ₹8).
   - ₹8 is debited from main balance and credited **exclusively to `UserGoldPot.balance_paise`**.
   - `sender_account.digital_gold_paise` is **not** altered.
2. **Pot Full Conversion to Pure Gold:**
   - When `pot.balance_paise >= PURCHASE_THRESHOLD_PAISE` (₹200 = 20,000 paise):
     - Entire pot balance is emptied to `0`.
     - Pure 24K digital gold is purchased at live market rate.
     - `sender_account.digital_gold_paise` is credited with the purchase amount.
     - Immutable `GoldLedger` row is recorded.
     - WebSocket pushes celebration confetti event (`gold_pot_update` with `purchased: true`).

---

## 3. Database Architecture & Schema Changes

### 3.1 New SQLAlchemy Models (`app/models/shopkeeper.py`)

```python
import uuid
from datetime import datetime, timezone, date
from sqlalchemy import (
    String, Boolean, BigInteger, Integer, Date, DateTime,
    ForeignKey, Text, Numeric
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.db.base import Base

class MerchantVoiceBox(Base):
    __tablename__ = "merchant_voicebox"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    language: Mapped[str] = mapped_column(String(20), default="hi") # hi, en, mr, bn, ta, te, bho
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    target_settlement_vpa: Mapped[str] = mapped_column(String(50), default="927922878@renopay")
    auto_announce_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    announce_balance: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User", backref="voicebox")


class KhatabookCustomer(Base):
    __tablename__ = "khatabook_customers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    merchant_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    upi_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    email: Mapped[str | None] = mapped_column(String(120), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    net_balance_paise: Mapped[int] = mapped_column(BigInteger, default=0) # >0: customer owes merchant, <0: advance
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    entries = relationship("KhatabookEntry", back_populates="customer", cascade="all, delete-orphan", order_by="desc(KhatabookEntry.entry_date)")


class KhatabookEntry(Base):
    __tablename__ = "khatabook_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("khatabook_customers.id", ondelete="CASCADE"))
    merchant_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    entry_type: Mapped[str] = mapped_column(String(10), nullable=False) # "gave" (udhar) or "received" (jama)
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    items_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    entry_date: Mapped[date] = mapped_column(Date, default=date.today)
    payment_mode: Mapped[str] = mapped_column(String(20), default="cash") # "cash", "renopay_upi", "bank"
    renopay_txn_ref: Mapped[str | None] = mapped_column(String(64), nullable=True)
    voice_transcribed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    customer = relationship("KhatabookCustomer", back_populates="entries")
```

---

## 4. API Endpoints Specification

### 4.1 Voice Box Module (`/api/v1/voicebox`)
- `GET /api/v1/voicebox/status`
  - Returns `{ is_active: bool, expires_at: string, days_remaining: int, language: string, auto_announce: bool, settlement_vpa: "927922878@renopay" }`.
- `POST /api/v1/voicebox/activate`
  - Validates user balance >= ₹200.
  - Debits ₹200 and routes credit to RenoPay account associated with `927922878`.
  - Sets `is_active = True`, `expires_at = now + 180 days`, selected language.
- `POST /api/v1/voicebox/change-language`
  - Validates user balance >= ₹100.
  - Debits ₹100 and routes fee to `927922878`.
  - Updates `language`.
- `POST /api/v1/voicebox/renew`
  - Debits ₹200, extends `expires_at` by 180 days.
- `GET /api/v1/voicebox/announcements`
  - Returns recent announcement logs with audio playback payload.

### 4.2 Khatabook Module (`/api/v1/khatabook`)
- `GET /api/v1/khatabook/summary`
  - Returns `{ total_customers, total_you_will_get, total_you_will_give, monthly_sales }`.
- `GET /api/v1/khatabook/customers`
  - Returns paginated list of customers with search, balances, and last transaction date.
- `POST /api/v1/khatabook/customers`
  - Creates customer profile (`name`, `phone`, `upi_id`, `email`, `address`).
- `GET /api/v1/khatabook/customers/{customer_id}`
  - Returns customer profile + full transaction ledger entries.
- `POST /api/v1/khatabook/customers/{customer_id}/entries`
  - Records an entry: `entry_type` (`gave` | `received`), `amount_paise`, `items_description`, `entry_date`, `payment_mode`.
  - Atomically recalculates `customer.net_balance_paise`.
- `POST /api/v1/khatabook/customers/{customer_id}/request-pay`
  - Dispatches a RenoPay UPI Money Request for the outstanding dues.
  - Links `khatabook_customer_id` in request metadata.
- `POST /api/v1/khatabook/voice-entry`
  - Accepts audio transcript or text string from mic.
  - Uses Saathi AI parsing to return parsed `{ customer_name, entry_type, amount, items_description }` and optionally auto-saves.

### 4.3 PDF Reports Module
- `GET /api/v1/khatabook/customers/{customer_id}/pdf`
  - Generates itemized customer monthly statement PDF using WeasyPrint/xhtml2pdf.
- `GET /api/v1/khatabook/reports/monthly-sales-pdf`
  - Generates full month business sales, collections, and week-wise breakdown PDF.

---

## 5. Automated UPI Request Reconciliation Flow

```
[Merchant] ── Click "Request ₹500 on RenoPay" ──► [Khatabook Backend]
                                                         │
                                                         ▼
                                                [Create MoneyRequest]
                                                (metadata: customer_id)
                                                         │
                                                         ▼
                                            [Customer Receives Alert]
                                                         │
                                                         ▼
                                            [Customer Pays via RenoPay]
                                                         │
                                                         ▼
                                                [Payment Engine]
                                                         │
                          ┌──────────────────────────────┴──────────────────────────────┐
                          ▼                                                             ▼
                 [Credit Merchant Balance]                                  [Khatabook Auto-Reconciliation]
                          │                                                             │
                          ▼                                                             ▼
             [WebSocket: payment_received]                                  [Insert KhatabookEntry: 'received']
                          │                                                 (Amount: ₹500, Mode: 'renopay_upi')
                          ▼                                                             │
             [Trigger Voice Box Announcement]                                           ▼
             "RenoPay par ₹500 prapt hue!"                                  [Deduct ₹500 from Customer Khata]
```

---

## 6. Digital Gold Pot Round-Up Fix Details

### Current Faulty Code:
In `payment_engine.py`:
```python
# Line 274-275
sender_account.current_balance_paise -= round_up_paise
sender_account.digital_gold_paise += round_up_paise # BUG!
gold_pot_info = await gold_service.execute_round_up(db, sender_user_id, round_up_paise)
```

### Correct Implementation:
```python
# 1. Round-up calculation (nearest ₹10)
rounded = ((amount_paise // 1000) + 1) * 1000 if amount_paise % 1000 else amount_paise
round_up_paise = rounded - amount_paise

if round_up_paise > 0 and sender_account.current_balance_paise >= round_up_paise:
    # 2. Debit main account balance
    sender_account.current_balance_paise -= round_up_paise
    
    # DO NOT add to digital_gold_paise here!
    
    # 3. Add to UserGoldPot
    gold_pot_info = await gold_service.execute_round_up(
        db, sender_user_id, round_up_paise
    )
    
    # 4. If pot crossed ₹200 threshold, execute_round_up buys gold and credits digital_gold_paise!
    if gold_pot_info.get("purchased"):
        sender_account.digital_gold_paise += gold_pot_info["purchase_amount_paise"]
```

---

## 7. Frontend UI/UX Architecture

### 7.1 New & Updated Screens
1. **`AccountingScreen.jsx`**:
   - Header tab switcher:
     - `[ 📊 Enterprise Accounting ]` (Default/Full Mode)
     - `[ 🏪 Shopkeeper Mode (दुकानदार) ]`
2. **`ShopkeeperHub.jsx`** (Sub-component / Screen):
   - **Top Sales Header Banner**: Full Month Sales counter, Udhar Given vs. Recovered, with **View PDF** and **Download PDF** buttons.
   - **Voice Box Control Card**:
     - Status: Active (174 days) or Inactive.
     - Language indicator: *हिन्दी (Hindi)* with change option.
     - Live Soundbox Simulator + Test Voice Announcement trigger.
     - Activate (₹200) / Renew modal.
   - **Khatabook Section**:
     - Customer summary pills.
     - Search input + "+ Add Customer" modal.
     - **Voice Mic Action (Saathi AI)**: Speaks to add entry.
     - Customer list with net balances.
3. **`CustomerLedgerModal.jsx`**:
   - Customer profile details (Name, Phone, UPI ID).
   - Date-wise itemized ledger table.
   - Actions: **Maine Diye (Udhar)** and **Maine Liye (Jama)** modals.
   - **Request Payment via RenoPay** button.
   - **View & Download Customer PDF** modal.

---

## 8. Implementation Phases & Task Checklist

### Phase 1: Database Schema & Gold Round-Up Fix
- [ ] Create `app/models/shopkeeper.py` (`MerchantVoiceBox`, `KhatabookCustomer`, `KhatabookEntry`).
- [ ] Register new models in `app/models/__init__.py`.
- [ ] Update `init_db.py` to create tables automatically.
- [ ] Fix `payment_engine.py` and `gold_service.py` to keep spare change in pot until ₹200 threshold.

### Phase 2: Backend APIs (Voice Box & Khatabook)
- [ ] Implement `app/routers/voicebox.py`:
  - Activation (₹200 to `927922878`), language change (₹100 to `927922878`), renewal.
- [ ] Implement `app/routers/khatabook.py`:
  - Customer CRUD, Entry CRUD, automated balance calculation.
  - Payment request trigger & webhook reconciliation on payment.
  - Saathi AI natural language voice entry parser.
- [ ] Register routers in `app/main.py`.

### Phase 3: PDF Generation Templates
- [ ] Create Jinja2 HTML/CSS template for **Customer Monthly Statement PDF**.
- [ ] Create Jinja2 HTML/CSS template for **Full Month Sales & Business PDF**.
- [ ] Integrate endpoints with `pdf_generator.py` streaming response.

### Phase 4: Frontend Implementation
- [ ] Add Mode Switcher in `AccountingScreen.jsx` (Corporate vs Shopkeeper).
- [ ] Build **Virtual Voice Box** component with Web Speech Synthesis and test sound.
- [ ] Build **Digital Khatabook** customer list, add customer modal, and search.
- [ ] Build **Customer Ledger Details** drawer with Udhar/Jama entry forms.
- [ ] Integrate **Saathi AI Voice Mic** for voice-based entry.
- [ ] Integrate **View PDF** (using `PdfPreviewModal`) and **Download PDF** for both statements.

### Phase 5: Verification & Quality Assurance
- [ ] Test end-to-end Voice Box activation and payment transfer to `927922878`.
- [ ] Test Voice Box incoming payment announcement speech in Hindi & English.
- [ ] Test Khatabook customer addition, Udhar/Jama entries, and balance calculations.
- [ ] Test 1-Tap UPI request payment and automatic Khata deduction.
- [ ] Test Saathi AI speech transcription and auto-entry.
- [ ] Verify both customer and monthly sales PDFs view and download properly.
- [ ] Test digital gold pot accumulation until ₹200 and pure gold conversion.
