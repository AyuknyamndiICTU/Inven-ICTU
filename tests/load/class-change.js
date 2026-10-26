// k6 class-change load test (S13 task 4) against a deployed LabPass API.
//   k6 run -e API=https://labpass.ictuniversity.edu.cm/api -e KIOSK_TOKENS=tok1,tok2,... -e CARD_UIDS=04..,04.. \
//          -e EQUIPMENT_ID=<uuid> tests/load/class-change.js
// Each VU acts as a student at one of the kiosks: identify (card) → borrow 1 item → return it.
// Target (DESIGN §7 / S13): 300 identify+borrow per minute for 15 minutes, p95 < 300 ms, no 5xx.
import http from 'k6/http';
import { check } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const API = __ENV.API;
const KIOSKS = (__ENV.KIOSK_TOKENS || '').split(',').filter(Boolean);
const CARDS = (__ENV.CARD_UIDS || '').split(',').filter(Boolean);
const EQUIPMENT_ID = __ENV.EQUIPMENT_ID;

export const options = {
  scenarios: {
    classChange: {
      executor: 'constant-arrival-rate',
      rate: 300,
      timeUnit: '1m',
      duration: __ENV.DURATION || '15m',
      preAllocatedVUs: 20,
      maxVUs: 60,
    },
  },
  thresholds: {
    'http_req_duration{kind:identify}': ['p(95)<300'],
    'http_req_duration{kind:borrow}': ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  const token = KIOSKS[Math.floor(Math.random() * KIOSKS.length)];
  const uid = CARDS[Math.floor(Math.random() * CARDS.length)];
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const id = http.post(`${API}/kiosk/identify`, JSON.stringify({ method: 'CARD', uid }), {
    headers,
    tags: { kind: 'identify' },
  });
  if (!check(id, { 'identify 200': (r) => r.status === 200 && r.json('status') === 'IDENTIFIED' })) return;
  const session = id.json('session.token');

  const borrow = http.post(
    `${API}/kiosk/sign-in`,
    JSON.stringify({ session, lines: [{ equipmentId: EQUIPMENT_ID, quantity: 1 }] }),
    { headers: { ...headers, 'Idempotency-Key': uuidv4() }, tags: { kind: 'borrow' } },
  );
  check(borrow, {
    'borrow 201 or 409 (stock)': (r) => r.status === 201 || r.status === 409,
    'no 5xx': (r) => r.status < 500,
  });
}
