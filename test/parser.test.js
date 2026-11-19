const test = require('node:test');
const assert = require('node:assert');
const { parseSms } = require('../src/services/smsParser');

const rx = new Date('2026-11-20T00:18:00+05:30');
const cases = [
  [`LKR 151,296.06 credited to AC **3009 for yas\n19/11/2026 10:39:36\nTo Inq Call 0112303050\nGet protected -Do not Share OTP`,
    { type: 'credit', currency: 'LKR', amount: 151296.06, account: '3009', txnAt: '2026-11-19T05:09:36.000Z' }],
  [`LKR 25,005.00 debited from AC **3009 via ATM at YAKKALA BRANCH CASH SET\n19/11/2026 12:17:43\nTo Inq Call 0112303050`,
    { type: 'debit', currency: 'LKR', amount: 25005, account: '3009', category: 'Cash Withdrawal' }],
  [`Other Bank Transfer (CEFTS) was performed on your Account No. 2705xxxx3161 for SGD 600.00 DR. Current Bal SGD 2579.09 Call 0114711411 for any inquiry.`,
    { type: 'debit', currency: 'SGD', amount: 600, account: '3161', balance: 2579.09, category: 'Transfer' }],
  [`Dear Customer, Funds successfully transferred! 2705XXXXX161 to Sampath Bank PLC for SGD 650.00 on 16 November 2026 07:13 PM.`,
    { type: 'debit', currency: 'SGD', amount: 650, account: '161', txnAt: '2026-11-16T13:43:00.000Z' }],
  [`CEFTS CHARGES was performed on your Account No. 2005xxxx5907 for LKR 25.00 DR. Current Bal LKR 2913.48 Call 0114711411 for any inquiry.`,
    { type: 'debit', amount: 25, category: 'Bank Charges' }],
  [`Loan Recovery  was performed on your Account No. 200XXXXX5907 for LKR 84769.54 DR. Current Bal LKR 7938.48`,
    { type: 'debit', amount: 84769.54, category: 'Loan Repayment', description: 'Loan Recovery' }],
  [`Inward TT D was performed on your Account No. 270XXXXX3161 for SGD 2398.03 CR. Current Bal SGD 3829.08`,
    { type: 'credit', currency: 'SGD', amount: 2398.03, category: 'Income (Foreign Transfer)' }],
  [`Inward TT D was performed on your Account No. 270XXXXX6539 for USD 1248.47 CR. Current Bal USD 1398.10`,
    { type: 'credit', currency: 'USD', amount: 1248.47, account: '6539', balance: 1398.1 }],
];

for (const [sms, expected] of cases) {
  test(`parses: ${sms.slice(0, 45)}`, () => {
    const t = parseSms(sms, rx);
    assert.ok(t, 'should parse');
    for (const [k, v] of Object.entries(expected)) {
      assert.strictEqual(k === 'txnAt' ? t.txnAt.toISOString() : t[k], v, k);
    }
  });
}

test('format B falls back to received time', () => {
  assert.strictEqual(parseSms(cases[2][0], rx).txnAt.toISOString(), rx.toISOString());
});

test('ignores non-transaction SMS', () => {
  assert.strictEqual(parseSms('Your OTP is 123456. Do not share.', rx), null);
});
