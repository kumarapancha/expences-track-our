// Integration test. Needs a MongoDB to talk to:
//   TEST_MONGODB_URI=mongodb://127.0.0.1:27017/expenses_test npm test
const test = require('node:test');
const assert = require('node:assert');

const uri = process.env.TEST_MONGODB_URI;
process.env.MONGODB_URI = uri || 'mongodb://unused';
process.env.APP_PASSWORD = 'secret-pass';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.SMS_API_KEY = 'test-sms-key';

test('API', { skip: !uri && 'set TEST_MONGODB_URI to run' }, async (t) => {
  const mongoose = require('mongoose');
  const { createApp } = require('../src/app');
  await mongoose.connect(uri);
  await mongoose.connection.db.dropDatabase();
  await require('../src/models/Transaction').init();

  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', cookie, ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const sms = (body, receivedAt) => call('POST', '/api/sms', { sender: 'BANK', body, receivedAt }, { 'x-api-key': 'test-sms-key' });

  try {
    await t.test('rejects SMS without API key', async () => {
      assert.strictEqual((await call('POST', '/api/sms', { body: 'x' })).status, 401);
    });

    await t.test('requires login for data', async () => {
      assert.strictEqual((await call('GET', '/api/summary?month=2026-11')).status, 401);
      assert.strictEqual((await call('POST', '/api/auth/login', { password: 'nope' })).status, 401);
      assert.strictEqual((await call('POST', '/api/auth/login', { password: 'secret-pass' })).status, 200);
    });

    await t.test('ingests SMS and is idempotent', async () => {
      const body = 'LKR 25,005.00 debited from AC **3009 via ATM at YAKKALA BRANCH CASH SET\n19/11/2026 12:17:43';
      const a = await sms(body);
      assert.strictEqual(a.status, 201);
      assert.strictEqual(a.data.parsed, true);
      const b = await sms(body); // MacroDroid retry
      assert.strictEqual(b.status, 200);
      assert.strictEqual(b.data.created, false);
    });

    await t.test('stores unparsed SMS for review', async () => {
      const r = await sms('Some new bank format we do not know yet', '2026-11-19T10:00:00+05:30');
      assert.strictEqual(r.data.parsed, false);
    });

    await t.test('accepts form-encoded body (MacroDroid)', async () => {
      const res = await fetch(base + '/api/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-api-key': 'test-sms-key' },
        body: new URLSearchParams({ sender: 'BANK', body: 'LKR 151,296.06 credited to AC **3009 for yas\n19/11/2026 10:39:36' }),
      });
      assert.strictEqual(res.status, 201);
    });

    await t.test('flags second SMS for same transfer as possible duplicate', async () => {
      const at = '2026-11-16T19:15:00+05:30';
      await sms('Dear Customer, Funds successfully transferred! 2705XXXXX161 to Sampath Bank PLC for SGD 650.00 on 16 November 2026 07:13 PM.', at);
      const b = await sms('Other Bank Transfer (CEFTS) was performed on your Account No. 2705xxxx3161 for SGD 650.00 DR. Current Bal SGD 3229.09', at);
      assert.strictEqual(b.data.possibleDuplicate, true);
    });

    await t.test('summary keeps currencies separate and skips duplicates', async () => {
      await sms('Inward TT D was performed on your Account No. 270XXXXX3161 for SGD 2398.03 CR. Current Bal SGD 3829.08', '2026-11-19T09:00:00+05:30');
      const { data } = await call('GET', '/api/summary?month=2026-11');
      const lkr = data.currencies.find((c) => c.currency === 'LKR');
      const sgd = data.currencies.find((c) => c.currency === 'SGD');
      assert.strictEqual(lkr.spent, 25005);
      assert.strictEqual(lkr.received, 151296.06);
      assert.strictEqual(sgd.spent, 650); // duplicate SMS not counted twice
      assert.strictEqual(sgd.received, 2398.03);
      assert.strictEqual(data.needsReview, 2); // 1 unparsed + 1 duplicate
    });

    await t.test('manual entry, edit, internal transfer exclusion', async () => {
      const m = await call('POST', '/api/transactions', {
        type: 'debit', amount: 1500, currency: 'LKR', description: 'Vegetables', category: 'Groceries', txnAt: '2026-11-18T09:00:00+05:30',
      });
      assert.strictEqual(m.status, 201);
      const atm = (await call('GET', '/api/transactions?month=2026-11&q=YAKKALA')).data[0];
      await call('PATCH', `/api/transactions/${atm._id}`, { category: 'Internal Transfer' });
      const { data } = await call('GET', '/api/summary?month=2026-11');
      const lkr = data.currencies.find((c) => c.currency === 'LKR');
      assert.strictEqual(lkr.spent, 1500);
      assert.deepStrictEqual(lkr.categories, [{ category: 'Groceries', amount: 1500 }]);
    });

    await t.test('rules categorize new and existing transactions', async () => {
      await call('POST', '/api/rules', { match: 'sampath', category: 'Family' });
      const { data } = await call('POST', '/api/rules/apply');
      assert.ok(data.updated >= 1);
      const rows = (await call('GET', '/api/transactions?month=2026-11&q=Sampath')).data;
      assert.ok(rows.some((r) => r.category === 'Family'));
    });

    await t.test('review list and fixing an unparsed SMS', async () => {
      const list = (await call('GET', '/api/transactions?review=1')).data;
      const unparsed = list.find((r) => !r.parsed);
      const r = await call('PATCH', `/api/transactions/${unparsed._id}`, { type: 'debit', amount: 300, currency: 'LKR', reviewed: true });
      assert.strictEqual(r.data.parsed, true);
      assert.strictEqual((await call('GET', '/api/transactions?review=1')).data.length, 1);
    });

    await t.test('serves the website', async () => {
      const res = await fetch(base + '/');
      assert.match(await res.text(), /<title>Expenses<\/title>/);
    });
  } finally {
    server.close();
    await mongoose.disconnect();
  }
});
