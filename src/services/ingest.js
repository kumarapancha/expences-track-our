const crypto = require('crypto');
const Transaction = require('../models/Transaction');
const Rule = require('../models/Rule');
const { parseSms } = require('./smsParser');

const DUPLICATE_WINDOW_MS = 15 * 60 * 1000;

const hashSms = (sender, body) =>
  crypto.createHash('sha256').update(`${(sender || '').toUpperCase()}|${body.trim()}`).digest('hex');

async function applyRules(tx, rules) {
  rules = rules || (await Rule.find().lean());
  const text = `${tx.description || ''} ${tx.merchant || ''}`.toUpperCase();
  const hit = rules.find((r) => text.includes(r.match.toUpperCase()));
  if (hit) tx.category = hit.category;
  return tx;
}

// One transfer can send two SMS (e.g. "Other Bank Transfer (CEFTS)" and
// "Funds successfully transferred!"). Flag the second one for review.
async function findPossibleDuplicate(tx) {
  if (!tx.parsed || !tx.amount) return null;
  const from = new Date(tx.txnAt.getTime() - DUPLICATE_WINDOW_MS);
  const to = new Date(tx.txnAt.getTime() + DUPLICATE_WINDOW_MS);
  const candidates = await Transaction.find({
    _id: { $ne: tx._id },
    type: tx.type,
    currency: tx.currency,
    amount: tx.amount,
    txnAt: { $gte: from, $lte: to },
    possibleDuplicateOf: null,
  }).lean();
  return candidates.find((c) => {
    if (c.pattern === tx.pattern) return false; // same format twice = two real transactions
    const a = c.account || '', b = tx.account || '';
    return !a || !b || a.endsWith(b) || b.endsWith(a);
  }) || null;
}

async function ingestSms({ sender, body, receivedAt }) {
  const rawHash = hashSms(sender, body);
  const existing = await Transaction.findOne({ rawHash });
  if (existing) return { tx: existing, created: false };

  const received = receivedAt ? new Date(receivedAt) : new Date();
  const safeReceived = isNaN(received) ? new Date() : received;
  const parsed = parseSms(body, safeReceived);

  const tx = new Transaction({
    source: 'sms',
    sender: sender || null,
    raw: body,
    rawHash,
    receivedAt: safeReceived,
    parsed: !!parsed,
    txnAt: safeReceived,
    category: 'Uncategorized',
    ...(parsed || {}),
  });
  if (parsed) await applyRules(tx);

  const dup = await findPossibleDuplicate(tx);
  if (dup) {
    tx.possibleDuplicateOf = dup._id;
    tx.excludeFromTotals = true;
  }

  try {
    await tx.save();
  } catch (err) {
    if (err.code === 11000) return { tx: await Transaction.findOne({ rawHash }), created: false };
    throw err;
  }
  return { tx, created: true };
}

module.exports = { ingestSms, applyRules, hashSms };
