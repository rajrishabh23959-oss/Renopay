# RenoPay Architecture & Technical Specification

> **System Classification**: High-Concurrency Financial Super-App & Merchant Operating System  
> **Review Standard**: Google SRE / Amazon Well-Architected Financial Services  
> **Target Invariants**: Zero-Float Integrity, Append-Only Double-Entry Ledger, Idempotent Transaction Execution  

---

## 1. System Overview & C4 Model

### 1.1 Context Diagram (C4 Level 1)

```mermaid
C4Context
    title System Context Diagram - RenoPay Fintech Ecosystem

    Person(consumer, "UPI Consumer", "Executes peer-to-peer payments, investments, digital gold savings, and bill splits.")
    Person(merchant, "Kirana Merchant", "Accepts customer payments, records udhar (credit), operates audio Soundbox, and generates balance sheets.")

    System(renopay, "RenoPay Core Platform", "FastAPI ASGI + React 18 + PostgreSQL + Redis. Enforces strict ACID paise ledger rules.")

    System_Ext(npci, "NPCI / Banking Rail", "Unified Payments Interface (UPI) resolution, payment gateways, and bank IMPS/NEFT networks.")
    System_Ext(bbps, "BBPS & Aggregators", "Bharat Bill Payment System and utility billers.")
    System_Ext(neon, "Neon PostgreSQL 16", "Serverless ACID relational database with connection pooling and point-in-time recovery.")
    System_Ext(upstash, "Upstash Redis", "Distributed cache, fanout pub/sub, rate limiting, and idempotency store.")

    Rel(consumer, renopay, "Sends money, scans BharatQR, views gold, claims gift cards", "HTTPS / WSS")
    Rel(merchant, renopay, "Audio Soundbox polling, Khatabook customer ledgers, journal entries", "HTTPS / WSS")
    Rel(renopay, npci, "Resolves VPAs, simulates settlement switches", "REST / ISO 8583")
    Rel(renopay, bbps, "Fetches bills, validates operator consumer numbers", "REST")
    Rel(renopay, neon, "Persists users, accounts, transactions, and double-entry journals", "asyncpg / SQL")
    Rel(renopay, upstash, "Stores rate-limit counters, gold rates, and idempotency locks", "RESP / TLS")
```

### 1.2 Container Diagram (C4 Level 2)

```mermaid
C4Container
    title Container Diagram - RenoPay Micro-Architectural Components

    Container(spa, "Single Page Application", "React 18, Vite 5, TailwindCSS", "Delivers 25+ fintech screens, camera QR scanning, audio synthesis, and offline-first state.")
    Container(apk, "Android Mobile App", "Capacitor 6 Android Bridge", "Native Android wrapper providing camera access, haptics, and secure hardware storage.")

    Container(api, "API Application Gateway", "FastAPI, Python 3.12, Uvicorn", "Stateless ASGI application handling routing, authentication, input validation, and business logic.")
    Container(ws, "Real-time Fanout Engine", "FastAPI WebSocket + Redis PubSub", "Pushes instant audio notifications to voiceboxes and live balance updates.")
    Container(pdf, "Document Rendering Engine", "WeasyPrint & xhtml2pdf", "Generates high-resolution tax invoices, official travel tickets, and gift vouchers.")

    ContainerDb(postgres, "Relational Database", "PostgreSQL 16", "Immutable append-only ledger, accounts, merchants, vaults, and Khatabook records.")
    ContainerDb(redis, "In-Memory Store", "Redis 7.2", "Sub-millisecond token blacklisting, sliding-window rate limiters, and gold spot cache.")

    Rel(spa, api, "API queries and mutations", "HTTPS / JSON")
    Rel(spa, ws, "Real-time voicebox and transaction events", "WSS")
    Rel(apk, api, "API queries and mutations", "HTTPS / JSON")

    Rel(api, postgres, "Reads and writes financial records", "asyncpg (NullPool in Serverless)")
    Rel(api, redis, "Rate limits and volatile caching", "redis-py / hiredis")
    Rel(api, pdf, "Generates transactional PDFs", "In-Process Streaming")
    Rel(ws, redis, "Subscribes to tenant transaction channels", "Pub/Sub")
```

---

## 2. Payment Data Flow & Sequence Diagram

The following sequence details an idempotent peer-to-peer payment execution from client gesture to immutable double-entry journal posting:

```mermaid
sequenceDiagram
    autonumber
    actor Alice as Payer (Alice)
    participant Client as RenoPay Client (React)
    participant Edge as Rate Limiter / Gateway
    participant Router as Payments Router (/send)
    participant Engine as Payment Engine
    participant Cache as Redis Idempotency Store
    participant DB as PostgreSQL (ACID)
    actor Bob as Payee (Bob)

    Alice->>Client: Enters ₹500, verifies UPI PIN, slides note
    Client->>Client: Generates client-side UUID idempotency_key
    Client->>Edge: POST /api/v1/payments/send (Bearer Token, Idempotency-Key)
    Edge->>Edge: Check IP sliding window (30 req/min)
    Edge->>Router: Forward authenticated request
    Router->>Engine: send_money(sender_id, receiver_vpa, 50000 paise, pin, key)

    Engine->>Cache: SETNX idempotency:{sender_id}:{key} EX 86400
    alt Idempotency Key Exists (Retry)
        Cache-->>Engine: Cached result returned
        Engine-->>Router: Replay original transaction response
        Router-->>Client: 200 OK (Identical txn_ref, no re-debit)
    else First Attempt
        Cache-->>Engine: Lock acquired
        Engine->>DB: BEGIN TRANSACTION (ISOLATION LEVEL READ COMMITTED)
        Engine->>DB: SELECT * FROM accounts WHERE user_id = :alice FOR UPDATE
        DB-->>Engine: Locked Alice account (Balance: 250000 paise)
        Engine->>DB: SELECT * FROM accounts WHERE vpa = :bob FOR UPDATE
        DB-->>Engine: Locked Bob account (Balance: 100000 paise)

        Engine->>Engine: Verify UPI PIN (Argon2id / bcrypt constant-time)
        Engine->>Engine: Verify Alice balance >= 50000 paise
        Engine->>Engine: Calculate optional Digital Gold round-up

        Engine->>DB: UPDATE accounts SET current_balance_paise = current_balance_paise - 50000 WHERE id = :alice_id
        Engine->>DB: UPDATE accounts SET current_balance_paise = current_balance_paise + 50000 WHERE id = :bob_id

        Engine->>DB: INSERT INTO transactions (Alice DEBIT, txn_group_id, amount_paise: 50000)
        Engine->>DB: INSERT INTO transactions (Bob CREDIT, txn_group_id, amount_paise: 50000)
        Engine->>DB: INSERT INTO journal_entries (Alice Expense, Bob Income)
        Engine->>DB: COMMIT TRANSACTION

        Engine->>Cache: SET idempotency:{sender_id}:{key} = payload
        Engine->>Router: PaymentSuccess(txn_ref, new_balance)
        Router-->>Client: 200 OK (Payment Verified)
        Client->>Alice: Audio Chime + Screen Reader "Payment Successful"
        Engine-)Bob: WebSocket push: "500 Rupees Received on RenoPay"
    end
```

---

## 3. Core Financial Invariants (Non-Negotiable)

RenoPay enforces four fundamental rules of financial systems engineering:

### 3.1 Integer-Precision Currency (`BigInteger` Paise)
Floating-point mathematics (`IEEE 754`) exhibits catastrophic rounding errors (e.g., `0.1 + 0.2 = 0.30000000000000004`). In RenoPay:
- **Rule**: All currency values in database columns (`current_balance_paise`, `amount_paise`, `net_balance_paise`) are strictly 64-bit integers representing Indian paise (₹1 = 100 paise).
- **Rule**: Mathematical conversions occur only at the serialization perimeter using `rupees_to_paise()` and `paise_to_rupees()`.
- **Validation**: Floating points with sub-paise fractional increments are rounded half-up deterministically or rejected.

### 3.2 Append-Only Immutable Ledger
- **Rule**: Ledger tables (`transactions`, `journal_entries`, `khatabook_entries`) are strictly append-only.
- **Rule**: No financial row may be executed with SQL `UPDATE` or `DELETE` on financial amounts.
- **Rule**: Corrections, chargebacks, and refunds MUST be represented as distinct compensatory ledger rows linked to the originating `txn_group_id`.

### 3.3 Pessimistic Concurrency (`SELECT ... FOR UPDATE`)
- **Rule**: Before any debit or credit operation, the relevant account rows MUST be locked via `SELECT FOR UPDATE`.
- **Deadlock Avoidance**: When locking multiple accounts in a single transaction (sender and receiver), account IDs are always sorted lexographically before locking (`ORDER BY id ASC`).

### 3.4 Cryptographic Idempotency Keys
- **Rule**: All payment and credit mutations require a unique client-generated UUID `idempotency_key`.
- **Storage**: Keys are stored in Redis with a 24-hour TTL and verified in the database transaction table (`txn_ref` uniqueness).
- **Behavior**: Duplicate requests return identical responses without initiating secondary ledger debits.

---

## 4. Failure Modes & Circuit Breakers

| Failure Scenario | Impact | RenoPay Defensive Architecture | Recovery Path |
|------------------|--------|-------------------------------|---------------|
| **Redis Node Outage** | Cache and rate-limiting unavailable | In-memory token bucket fallback automatically activates (`FallbackMemoryLimiter`). Read requests bypass cache and query Postgres with explicit index limits. | Background healthcheck retries Redis connection; cache self-heals upon node reconnection. |
| **Postgres Connection Exhaustion** | Latency spike on DB pool | In Vercel serverless mode, `NullPool` is enforced to prevent zombie idle connections. Composite indexes ensure queries execute under 5ms, minimizing connection holding time. | Neon auto-scales compute; client timeouts trigger graceful retry with exponential backoff. |
| **Concurrent Double-Spend Attack** | Attacker executes 10 simultaneous debits on zero/low balance | `SELECT FOR UPDATE` serializes the 10 transactions. The first transaction succeeds and drains the balance; subsequent 9 transactions fail `INSUFFICIENT_FUNDS` checks. | Verified by test suite `tests/test_concurrency_payments.py`. |
| **PDF Rendering Library Failure** | WeasyPrint native C-libraries absent | Service gracefully falls back to pure-Python `xhtml2pdf` engine, ensuring tickets and receipts continue generating. | Zero crash; degraded font rendering fallback logged with warning. |
