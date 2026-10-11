import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, getAuthHeaders } from './common.js';

export const options = {
  scenarios: {
    constant_request_rate: {
      executor: 'constant-arrival-rate',
      rate: 500, // 500 RPS
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 100,
      maxVUs: 300,
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<50', 'p(99)<100'], // Redis cached balance reads p95 < 50ms
    'http_req_failed': ['rate<0.01'],              // Under 1% error rate
  },
};

const DEMO_TOKEN = __ENV.DEMO_TOKEN || 'test-jwt-token';

export default function () {
  const headers = getAuthHeaders(DEMO_TOKEN);
  const res = http.get(`${BASE_URL}/accounts/me`, { headers });

  check(res, {
    'status is 200 or 401': (r) => r.status === 200 || r.status === 401,
    'latency is sub-50ms': (r) => r.timings.duration < 50,
  });
}
