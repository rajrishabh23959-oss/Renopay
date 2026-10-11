# RenoPay Performance & Load Testing Suite

This directory contains production-grade load testing scripts using [Grafana k6](https://k6.io/) alongside a lightweight Python asynchronous benchmark harness.

---

## 1. Test Scenarios & SLO Targets

| Scenario Script | Concurrency / Target | Target Endpoint | SLO Threshold | Description |
|-----------------|----------------------|-----------------|---------------|-------------|
| `auth_flow.js` | 100 concurrent VUs | `POST /api/v1/auth/login` | p95 < 200ms, Errors < 1% | Simulates 100 concurrent phone/PIN auth attempts. |
| `balance_read.js` | 500 RPS (constant arrival rate) | `GET /api/v1/accounts/me` | p95 < 50ms, Errors < 1% | Validates Redis cache survival under high read volume. |
| `idempotent_payment.js` | 50 concurrent VUs | `POST /api/v1/payments/send` | p95 < 800ms, 0 Duplicate Debits | Tests ACID double-spend prevention & duplicate idempotency key reuse. |
| `history_pagination.js` | 50 concurrent VUs | `GET /api/v1/payments/transactions` | Cursor p95 < 150ms vs Offset p95 < 400ms | Compares keyset cursor pagination (`ix_txns_acc_created`) vs deep offset scan. |

---

## 2. Running with Grafana k6

### Installation
- **macOS**: `brew install k6`
- **Linux**: `sudo apt-get install k6`
- **Windows (Chocolatey)**: `choco install k6`
- **Windows (Winget)**: `winget install k6`
- **Docker**: `docker run --rm -i grafana/k6 run - < load-tests/balance_read.js`

### Execution Examples
Set `BASE_URL` and `DEMO_TOKEN` environment variables as needed:

```bash
# 1. Run Auth Flow benchmark
k6 run -e BASE_URL=http://localhost:8000/api/v1 load-tests/auth_flow.js

# 2. Run Redis Cache Read benchmark (500 RPS)
k6 run -e BASE_URL=http://localhost:8000/api/v1 -e DEMO_TOKEN=your_jwt_here load-tests/balance_read.js

# 3. Run Idempotent Payments Concurrency benchmark
k6 run -e BASE_URL=http://localhost:8000/api/v1 -e DEMO_TOKEN=your_jwt_here load-tests/idempotent_payment.js

# 4. Run Pagination Comparison
k6 run -e BASE_URL=http://localhost:8000/api/v1 -e DEMO_TOKEN=your_jwt_here load-tests/history_pagination.js
```

---

## 3. Local Synthetic Runner (No k6 / Docker required)

If k6 is not installed on your local environment, use the Python synthetic load runner to verify concurrency characteristics and calculate latency percentiles:

```bash
python load-tests/run_load_simulation.py --concurrency 50 --duration 10 --scenario balance_read
```
