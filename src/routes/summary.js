const router = require('express').Router();
const Transaction = require('../models/Transaction');
const { monthRange } = require('../services/dates');
const { BANKS, bankOf, bankFilter } = require('../services/bank');

// GET /api/summary?month=2026-11&bank=sampath|ntb (bank optional)
// Totals per currency (never mixed), plus spending by category.
router.get('/', async (req, res, next) => {
  try {
    const r = monthRange(req.query.month);
    if (!r) return res.status(400).json({ error: 'month must be YYYY-MM' });
    const bank = req.query.bank || '';
    if (bank && !BANKS.includes(bank)) return res.status(400).json({ error: 'bank must be sampath or ntb' });

    const rows = await Transaction.find({
      txnAt: { $gte: r.start, $lt: r.end },
      parsed: true,
      excludeFromTotals: { $ne: true },
      ...bankFilter(bank),
    }).lean();

    const byCurrency = {};
    for (const t of rows) {
      const c = (byCurrency[t.currency] ||= {
        currency: t.currency, spent: 0, received: 0, count: 0, categories: {}, spentByBank: { sampath: 0, ntb: 0 },
      });
      c.count++;
      if (t.type === 'debit') {
        c.spent += t.amount;
        c.spentByBank[bankOf(t)] += t.amount;
        c.categories[t.category] = (c.categories[t.category] || 0) + t.amount;
      } else {
        c.received += t.amount;
      }
    }
    const round = (n) => Math.round(n * 100) / 100;
    const currencies = Object.values(byCurrency).map((c) => ({
      currency: c.currency,
      spent: round(c.spent),
      received: round(c.received),
      net: round(c.received - c.spent),
      spentByBank: { sampath: round(c.spentByBank.sampath), ntb: round(c.spentByBank.ntb) },
      count: c.count,
      categories: Object.entries(c.categories)
        .map(([category, amount]) => ({ category, amount: round(amount) }))
        .sort((a, b) => b.amount - a.amount),
    })).sort((a, b) => b.count - a.count);

    const needsReview = await Transaction.countDocuments({
      reviewed: { $ne: true },
      $and: [
        { $or: [{ parsed: false }, { possibleDuplicateOf: { $ne: null } }] },
        bankFilter(bank),
      ],
    });

    res.json({ month: req.query.month, bank: bank || null, currencies, needsReview });
  } catch (e) { next(e); }
});

module.exports = router;
