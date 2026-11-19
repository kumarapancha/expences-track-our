// Parses bank SMS alerts into transactions.
// Returns null when no pattern matches; keep the raw SMS and review it manually.

const num = (s) => parseFloat(s.replace(/,/g, ''));
// Visible digits after the mask: '2705xxxx3161' -> '3161', '2705XXXXX161' -> '161'
const last4 = (acct) => (acct.match(/(\d+)\W*$/) || [, acct])[1].slice(-4);

function parseDateDMY(s) {
  // "19/11/2026 10:39:36"
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}+05:30`) : null;
}

function parseDateLong(s) {
  // "16 November 2026 07:13 PM"
  const m = s.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const mo = months.indexOf(m[2].toLowerCase());
  if (mo < 0) return null;
  let h = +m[4] % 12; if (m[6].toUpperCase() === 'PM') h += 12;
  const pad = (n) => String(n).padStart(2, '0');
  return new Date(`${m[3]}-${pad(mo + 1)}-${pad(m[1])}T${pad(h)}:${m[5]}:00+05:30`);
}

// Map bank descriptions to a default category; edit to taste.
function categorize(t) {
  const d = `${t.description || ''} ${t.merchant || ''}`.toUpperCase();
  if (/ATM|CASH/.test(d)) return 'Cash Withdrawal';
  if (/CHARGE|FEE/.test(d)) return 'Bank Charges';
  if (/LOAN/.test(d)) return 'Loan Repayment';
  if (/INWARD TT/.test(d)) return 'Income (Foreign Transfer)';
  if (/TRANSFER|CEFTS/.test(d)) return 'Transfer';
  return t.type === 'credit' ? 'Income' : 'Uncategorized';
}

const patterns = [
  {
    // "LKR 25,005.00 debited from AC **3009 via ATM at YAKKALA BRANCH CASH SET\n19/11/2026 12:17:43"
    // "LKR 151,296.06 credited to AC **3009 for yas\n19/11/2026 10:39:36"
    name: 'format-A (credited/debited AC)',
    re: /^(?<cur>[A-Z]{3})\s+(?<amt>[\d,]+\.\d{2})\s+(?<dir>credited|debited)\s+(?:to|from)\s+AC\s+(?<acct>\S+)\s*(?<rest>.*?)\s*\n\s*(?<dt>\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/is,
    build: (g) => ({
      currency: g.cur.toUpperCase(),
      amount: num(g.amt),
      type: g.dir.toLowerCase() === 'credited' ? 'credit' : 'debit',
      account: last4(g.acct),
      description: g.rest.replace(/^(via|for)\s+/i, '').trim() || null,
      merchant: (g.rest.match(/\bat\s+(.+)$/i) || [])[1]?.trim() || null,
      txnAt: parseDateDMY(g.dt),
      balance: null,
    }),
  },
  {
    // "Loan Recovery  was performed on your Account No. 200XXXXX5907 for LKR 84769.54 DR. Current Bal LKR 7938.48"
    name: 'format-B (was performed on your Account)',
    re: /^(?<desc>.+?)\s+was performed on your Account No\.?\s*(?<acct>[\dxX*]+)\s+for\s+(?<cur>[A-Z]{3})\s+(?<amt>[\d,]+\.\d{2})\s+(?<dir>DR|CR)\b(?:.*?Current Bal\s+[A-Z]{3}\s+(?<bal>[\d,]+\.\d{2}))?/is,
    build: (g) => ({
      currency: g.cur.toUpperCase(),
      amount: num(g.amt),
      type: g.dir.toUpperCase() === 'CR' ? 'credit' : 'debit',
      account: last4(g.acct),
      description: g.desc.replace(/\s+/g, ' ').trim(),
      merchant: null,
      txnAt: null, // SMS has no time; caller falls back to receivedAt
      balance: g.bal ? num(g.bal) : null,
    }),
  },
  {
    // "Dear Customer, Funds successfully transferred! 2705XXXXX161 to Sampath Bank PLC for SGD 650.00 on 16 November 2026 07:13 PM."
    name: 'format-C (Funds successfully transferred)',
    re: /Funds successfully transferred!?\s*(?<acct>[\dxX*]+)\s+to\s+(?<to>.+?)\s+for\s+(?<cur>[A-Z]{3})\s+(?<amt>[\d,]+\.\d{2})\s+on\s+(?<dt>.+?(?:AM|PM))/is,
    build: (g) => ({
      currency: g.cur.toUpperCase(),
      amount: num(g.amt),
      type: 'debit',
      account: last4(g.acct),
      description: `Transfer to ${g.to.trim()}`,
      merchant: g.to.trim(),
      txnAt: parseDateLong(g.dt),
      balance: null,
    }),
  },
];

function parseSms(body, receivedAt = new Date()) {
  const text = body.replace(/\r/g, '').trim();
  for (const p of patterns) {
    const m = text.match(p.re);
    if (m) {
      const t = p.build(m.groups);
      t.txnAt = t.txnAt || new Date(receivedAt);
      t.category = categorize(t);
      t.pattern = p.name;
      return t;
    }
  }
  return null;
}

module.exports = { parseSms };
