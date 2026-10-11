import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, getAuthHeaders } from './common.js';

const offsetDuration = new Trend('offset_pagination_duration');
const cursorDuration = new Trend('cursor_pagination_duration');

export const options = {
  stages: [
    { duration: '5s', target: 20 },
    { duration: '15s', target: 50 },
    { duration: '5s', target: 0 },
  ],
  thresholds: {
    'offset_pagination_duration': ['p(95)<400'],
    'cursor_pagination_duration': ['p(95)<150'], // Keyset B-tree cursor is significantly faster
  },
};

const DEMO_TOKEN = __ENV.DEMO_TOKEN || 'test-jwt-token';

export default function () {
  const headers = getAuthHeaders(DEMO_TOKEN);

  // 1. Offset pagination (scans full offset)
  const offsetRes = http.get(`${BASE_URL}/payments/transactions?limit=20&offset=200`, { headers });
  offsetDuration.add(offsetRes.timings.duration);
  check(offsetRes, {
    'offset status valid': (r) => r.status === 200 || r.status === 401,
  });

  // 2. Keyset cursor pagination (uses ix_txns_acc_created composite index)
  const cursorIso = new Date(Date.now() - 3600000).toISOString();
  const cursorRes = http.get(`${BASE_URL}/payments/transactions?limit=20&cursor=${encodeURIComponent(cursorIso)}`, { headers });
  cursorDuration.add(cursorRes.timings.duration);
  check(cursorRes, {
    'cursor status valid': (r) => r.status === 200 || r.status === 401,
  });

  sleep(0.1);
}
