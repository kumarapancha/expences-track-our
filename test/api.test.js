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

    await t.test('does not store SMS that match no known format', async () => {
      for (const body of ['Some new bank format we do not know yet', 'Your OTP is 123456. Do not share.']) {
        const r = await sms(body, '2026-11-19T10:00:00+05:30');
        assert.strictEqual(r.status, 202);
        assert.strictEqual(r.data.ignored, true);
      }
      assert.strictEqual(await require('../src/models/Transaction').countDocuments({ parsed: false }), 0);
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
      assert.strictEqual(data.needsReview, 1); // the duplicate
    });

    await t.test('splits summary and list by bank (3009 = Sampath)', async () => {
      const s = (await call('GET', '/api/summary?month=2026-11&bank=sampath')).data;
      const n = (await call('GET', '/api/summary?month=2026-11&bank=ntb')).data;
      assert.deepStrictEqual(s.currencies.map((c) => c.currency), ['LKR']);
      assert.strictEqual(s.currencies[0].spent, 25005);
      assert.ok(!n.currencies.some((c) => c.currency === 'LKR'));
      assert.strictEqual(n.currencies.find((c) => c.currency === 'SGD').spent, 650);
      const rows = (await call('GET', '/api/transactions?month=2026-11&bank=sampath')).data;
      assert.ok(rows.length && rows.every((r) => r.bank === 'sampath' && r.account === '3009'));
      assert.strictEqual((await call('GET', '/api/summary?month=2026-11&bank=hnb')).status, 400);
      const all = (await call('GET', '/api/summary?month=2026-11')).data;
      assert.deepStrictEqual(all.currencies.find((c) => c.currency === 'LKR').spentByBank, { sampath: 25005, ntb: 0 });
      assert.deepStrictEqual(all.currencies.find((c) => c.currency === 'SGD').spentByBank, { sampath: 0, ntb: 650 });
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

    await t.test('review list and clearing a possible duplicate', async () => {
      const list = (await call('GET', '/api/transactions?review=1')).data;
      assert.strictEqual(list.length, 1);
      const r = await call('PATCH', `/api/transactions/${list[0]._id}`, { possibleDuplicateOf: null, excludeFromTotals: false, reviewed: true });
      assert.strictEqual(r.data.possibleDuplicateOf, null);
      assert.strictEqual((await call('GET', '/api/transactions?review=1')).data.length, 0);
    });

    await t.test('bulk delete', async () => {
      const made = [];
      for (const amount of [11, 22, 33]) {
        made.push((await call('POST', '/api/transactions', { type: 'debit', amount, currency: 'LKR', description: 'bulk test' })).data._id);
      }
      assert.strictEqual((await call('POST', '/api/transactions/bulk-delete', { ids: [] })).status, 400);
      assert.strictEqual((await call('POST', '/api/transactions/bulk-delete', { ids: ['nope'] })).status, 400);
      const r = await call('POST', '/api/transactions/bulk-delete', { ids: made.slice(0, 2) });
      assert.deepStrictEqual(r.data, { deleted: 2 });
      const left = (await call('GET', '/api/transactions?q=bulk test')).data;
      assert.deepStrictEqual(left.map((x) => x._id), [made[2]]);
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
