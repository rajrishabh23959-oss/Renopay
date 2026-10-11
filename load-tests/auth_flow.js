import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, DEFAULT_HEADERS } from './common.js';

export const options = {
  stages: [
    { duration: '5s', target: 50 },    // Ramp up to 50 users
    { duration: '15s', target: 100 },  // Ramp up to 100 concurrent users
    { duration: '10s', target: 100 },  // Steady load at 100 users
    { duration: '5s', target: 0 },     // Ramp down to 0
  ],
  thresholds: {
    'http_req_duration': ['p(95)<200'],  // 95% of requests must complete under 200ms
    'http_req_failed': ['rate<0.01'],    // Under 1% error rate allowed
  },
};

export default function () {
  // Simulate unique login payloads per VU/iteration
  const payload = JSON.stringify({
    phone_number: `9198765${String(__VU % 100).padStart(3, '0')}`,
    pin: '123456',
    device_fingerprint: `device-vu-${__VU}`,
  });

  const res = http.post(`${BASE_URL}/auth/login`, payload, {
    headers: DEFAULT_HEADERS,
  });

  check(res, {
    'login status is 200 or 401': (r) => r.status === 200 || r.status === 401,
    'response time p95 is under 200ms': (r) => r.timings.duration < 200,
  });

  sleep(0.1);
}
