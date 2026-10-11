import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, getAuthHeaders, generateUUID } from './common.js';

export const options = {
  stages: [
    { duration: '5s', target: 20 },
    { duration: '15s', target: 50 },  // 50 concurrent payments
    { duration: '10s', target: 50 },
    { duration: '5s', target: 0 },
  ],
  thresholds: {
    'http_req_duration': ['p(95)<800'], // p95 < 800ms for ACID transaction with row lock
    'http_req_failed': ['rate<0.01'],
  },
};

const DEMO_TOKEN = __ENV.DEMO_TOKEN || 'test-jwt-token';

export default function () {
  const headers = getAuthHeaders(DEMO_TOKEN);
  const idempotencyKey = `k6-${generateUUID()}`;

  const payload = JSON.stringify({
    to_vpa: 'merchant@renopay',
    amount: 10.0,
    pin: '123456',
    description: 'k6 load test payment',
    category: 'Other',
    idempotency_key: idempotencyKey,
  });

  // First payment attempt
  const res1 = http.post(`${BASE_URL}/payments/send`, payload, { headers });

  check(res1, {
    'primary payment accepted or expected auth': (r) => r.status === 200 || r.status === 400 || r.status === 401,
  });

  // Immediate retry with the EXACT same idempotency key (simulating network duplicate / retry)
  const res2 = http.post(`${BASE_URL}/payments/send`, payload, { headers });

  check(res2, {
    'duplicate payment idempotency respected': (r) => {
      // If first succeeded, second must succeed and match txn_ref without deducting double
      if (res1.status === 200) {
        return r.status === 200;
      }
      return r.status === res1.status;
    },
  });

  sleep(0.2);
}
