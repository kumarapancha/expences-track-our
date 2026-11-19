const router = require('express').Router();
const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const { applyRules } = require('../services/ingest');
const { monthRange } = require('../services/dates');

const EDITABLE = ['type', 'amount', 'currency', 'description', 'merchant', 'category',
  'txnAt', 'excludeFromTotals', 'notes', 'account', 'reviewed'];

function pick(body) {
  const out = {};
  for (const k of EDITABLE) if (body[k] !== undefined) out[k] = body[k];
  if (out.amount !== undefined) out.amount = Math.abs(Number(out.amount));
  if (out.txnAt) out.txnAt = new Date(out.txnAt);
  if (out.category) out.categoryLocked = out.category !== 'Uncategorized';
  // Internal transfers never count as spending or income
  if (out.category === 'Internal Transfer') out.excludeFromTotals = true;
  return out;
}

const validId = (req, res, next) =>
  mongoose.isValidObjectId(req.params.id) ? next() : res.status(404).json({ error: 'Not found' });

// GET /api/transactions?month=2026-11&currency=LKR&type=debit&category=Groceries&review=1&q=atm
router.get('/', async (req, res, next) => {
  try {
    const { month, currency, type, category, review, q } = req.query;
    const filter = {};
    if (month) {
      const r = monthRange(month);
      if (!r) return res.status(400).json({ error: 'month must be YYYY-MM' });
      filter.txnAt = { $gte: r.start, $lt: r.end };
    }
    if (currency) filter.currency = currency.toUpperCase();
    if (type) filter.type = type;
    if (category) filter.category = category;
    if (review === '1') {
      filter.reviewed = { $ne: true };
      filter.$or = [{ parsed: false }, { possibleDuplicateOf: { $ne: null } }];
    }
    let rows = await Transaction.find(filter).sort({ txnAt: -1 }).limit(1000).lean();
    if (q) {
      const needle = q.toUpperCase();
      rows = rows.filter((t) =>
        `${t.description || ''} ${t.merchant || ''} ${t.raw || ''} ${t.notes || ''}`.toUpperCase().includes(needle));
    }
    res.json(rows);
  } catch (e) { next(e); }
});

// Manual entry (cash spending etc.)
router.post('/', async (req, res, next) => {
  try {
    const data = pick(req.body || {});
    if (!data.amount || !['debit', 'credit'].includes(data.type)) {
      return res.status(400).json({ error: 'amount and type (debit|credit) are required' });
    }
    const tx = new Transaction({ source: 'manual', parsed: true, txnAt: new Date(), ...data });
    if (!data.category || data.category === 'Uncategorized') { tx.categoryLocked = false; await applyRules(tx); }
    await tx.save();
    res.status(201).json(tx);
  } catch (e) { next(e); }
});

router.patch('/:id', validId, async (req, res, next) => {
  try {
    const data = pick(req.body || {});
    // Filling in amount/type for an unparsed SMS makes it a normal transaction
    if (data.amount && data.type) data.parsed = true;
    if (req.body?.possibleDuplicateOf === null) data.possibleDuplicateOf = null;
    const tx = await Transaction.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!tx) return res.status(404).json({ error: 'Not found' });
    res.json(tx);
  } catch (e) { next(e); }
});

router.delete('/:id', validId, async (req, res, next) => {
  try {
    const tx = await Transaction.findByIdAndDelete(req.params.id);
    if (!tx) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
