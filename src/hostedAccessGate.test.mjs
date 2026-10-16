import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCESS_COOKIE,
  accessKeyMatches,
  createAccessGate,
} from '../server/hosted/access-gate.js';

const KEY = 'correct-horse-battery-staple';

function run(gate, { url = '/', cookie } = {}) {
  const res = {
    status: null,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body = '') {
      this.body = body;
    },
  };
  let passed = false;
  gate({ url, headers: cookie ? { cookie } : {} }, res, () => {
    passed = true;
  });
  return { passed, res };
}

test('the hosted server refuses to start without a usable access key', () => {
  assert.throws(() => createAccessGate(undefined), /GEV_ACCESS_KEY/);
  assert.throws(() => createAccessGate('short'), /GEV_ACCESS_KEY/);
});

test('requests without the key are refused, pages and API alike', () => {
  const gate = createAccessGate(KEY);
  for (const url of ['/', '/api/radio/stations', '/assets/index.js']) {
    const { passed, res } = run(gate, { url });
    assert.equal(passed, false);
    assert.equal(res.status, 401);
  }
  assert.equal(run(gate, { url: '/?key=wrong' }).res.status, 401);
  assert.equal(run(gate, { cookie: `${ACCESS_COOKIE}=wrong` }).res.status, 401);
});

test('a correct ?key= sets the cookie and redirects without the key', () => {
  const { passed, res } = run(createAccessGate(KEY), {
    url: `/?view=globe&key=${KEY}`,
  });
  assert.equal(passed, false);
  assert.equal(res.status, 302);
  assert.equal(res.headers.Location, '/?view=globe');
  assert.match(res.headers['Set-Cookie'], /^gev_access=/);
  assert.match(res.headers['Set-Cookie'], /HttpOnly; Secure; SameSite=Lax/);
});

test('the access cookie admits later requests', () => {
  const { passed } = run(createAccessGate(KEY), {
    url: '/api/radio/stations',
    cookie: `theme=dark; ${ACCESS_COOKIE}=${KEY}`,
  });
  assert.equal(passed, true);
});

test('key comparison rejects empty and mismatched values', () => {
  assert.equal(accessKeyMatches('', KEY), false);
  assert.equal(accessKeyMatches(null, KEY), false);
  assert.equal(accessKeyMatches(`${KEY}x`, KEY), false);
  assert.equal(accessKeyMatches(KEY, KEY), true);
});
