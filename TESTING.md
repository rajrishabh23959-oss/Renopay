# RenoPay Quality Assurance & Testing Engineering Specification

> **Engineering Standard**: Google SRE / Amazon Bar-Raiser Quality Verification  
> **CI Gates**: Enforced Fail-Under Thresholds (Backend ≥85%, Frontend ≥70%)  

---

## 1. Test Strategy Pyramid

```
                  ▲
                 / \
                /   \     E2E / Browser Flows (k6 & Subagent Testing)
               /-----\
              /       \   Concurrency & Multi-Tenant IDOR Regression (PostgreSQL)
             /---------\
            /           \ Integration & API Contract Tests (FastAPI / TestClient)
           /-------------\
          /               \ Component Unit & Interaction Tests (Vitest + React Testing Library)
         /-----------------\
        /                   \ Pure Logic & Property-Based Precision Tests (Money Invariants)
       /---------------------\
```

---

## 2. Concurrency Stress Test Architecture & SQL Trace

Financial platforms cannot rely on mocking to verify data correctness; race conditions occur exclusively at the database locking boundary.

### 2.1 Double-Spend Prevention Test (`tests/test_concurrency_payments.py`)

**Scenario**:
- Payer account initialized with exactly **1,000 paise** (₹10.00).
- 10 concurrent tasks simultaneously fire payment requests of **200 paise** each targeting a merchant account.
- If no row lock were present, all 10 tasks would read `balance = 1000`, debit 200, and overdraft the account to a negative balance.

**SQL Trace Under Execution**:
```sql
-- Worker 1
BEGIN;
SELECT id, current_balance_paise FROM accounts WHERE id = 'alice' FOR UPDATE;
-- [Worker 1 acquires row lock; balance is 1000]

-- Workers 2 through 10
BEGIN;
SELECT id, current_balance_paise FROM accounts WHERE id = 'alice' FOR UPDATE;
-- [Workers 2 through 10 BLOCKED on postgres row lock waiting for Worker 1 to COMMIT/ROLLBACK]

-- Worker 1 proceeds:
UPDATE accounts SET current_balance_paise = 800 WHERE id = 'alice';
INSERT INTO transactions (amount_paise, type) VALUES (200, 'debit');
COMMIT;

-- Worker 2 acquires lock:
-- [Worker 2 now reads updated balance = 800]
UPDATE accounts SET current_balance_paise = 600 WHERE id = 'alice';
COMMIT;

-- ...
-- By Worker 6:
-- [Worker 6 reads balance = 0 paise]
-- INSUFFICIENT_FUNDS raised!
ROLLBACK;
```

**Verification Invariant**:
- Exactly **5 debits succeed** (5 × 200 = 1,000 paise).
- Exactly **5 debits fail** with HTTP 400 (`INSUFFICIENT_FUNDS`).
- Final payer balance: **exactly 0 paise**.
- Final payee balance: **exactly 1,000 paise**.
- Transaction ledger: **zero orphaned rows**.

---

### 2.2 Idempotency Collision Test

**Scenario**:
- 5 concurrent requests hit `/payments/send` using the exact same `idempotency_key`.

**Verification Invariant**:
- Exactly **1 payment executes**.
- Remaining 4 requests return the exact same transaction reference (`txn_ref`) without creating secondary debit rows.

---

## 3. Frontend Vitest Test Matrix (10 Suites, 45 Tests)

Every major user interaction and financial screen is tested using **Vitest** and **React Testing Library**:

| Test Suite File | Test Count | Scenarios Tested |
|-----------------|:----------:|------------------|
| `Nav.test.jsx` | 7 | Bottom navigation tabs, sub-menu overlays, active indicator badges. |
| `PayScreen.test.jsx` | 6 | VPA validation, normal vs advance pay toggles, PIN input, receipt generation. |
| `SplitScreen.test.jsx` | 5 | Bill splitting across friends, UPI handle chips, equal calculation. |
| `LoginScreen.test.jsx` | 5 | Phone formatting, OTP entry, PIN authentication, error handling. |
| `ProfileScreen.test.jsx` | 5 | User details rendering, language toggle, monthly budget updates. |
| `GiftCardScreen.test.jsx` | 4 | Voucher theme selection, creation modal, code redemption. |
| `RequestScreen.test.jsx` | 4 | Money request form, VPA verification, minimum amount validation. |
| `AccountingScreen.test.jsx` | 3 | Shopkeeper vs Enterprise mode switch, Developer Mode balanced Trial Balance. |
| `ShopkeeperHub.test.jsx` | 3 | Merchant dashboard metrics, Khatabook customer ledgers, due vs advance tabs. |
| `VaultScreen.test.jsx` | 3 | Multi-sig shared vaults, target vs current balance progress bars. |
| **Total** | **45** | **100% Pass Rate Across All Suites** |

---

## 4. How to Execute Tests

### 4.1 Backend Test Execution

```bash
cd renopay-backend

# 1. Run money invariant unit tests (zero external dependencies)
python -m pytest tests/test_money.py -v

# 2. Run full suite with coverage check
python -m pytest tests/ --cov=app --cov-report=term-missing --cov-fail-under=85

# 3. Run concurrency stress tests specifically (requires running PostgreSQL)
python -m pytest tests/test_concurrency_payments.py -v
```

### 4.2 Frontend Test Execution

```bash
cd renopay-frontend

# 1. Run all Vitest suites
npm test

# 2. Run with coverage report
npm run test:coverage
```

### 4.3 CI Pipeline Gates (`.github/workflows/`)

- **Security & Secret Audit**: `gitleaks` scans all commits for leaked keys.
- **Dependency Vulnerabilities**: `pip-audit` scans Python packages; `npm audit` scans Node packages.
- **Coverage Enforcement**: Builds automatically fail if backend coverage drops below 85% or frontend coverage drops below 70%.
