const router = require('express').Router();
const mongoose = require('mongoose');
const Rule = require('../models/Rule');
const Transaction = require('../models/Transaction');
const { applyRules } = require('../services/ingest');

router.get('/', async (req, res, next) => {
  try { res.json(await Rule.find().sort({ createdAt: 1 }).lean()); } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const { match, category } = req.body || {};
    if (!match?.trim() || !category?.trim()) return res.status(400).json({ error: 'match and category are required' });
    res.status(201).json(await Rule.create({ match, category }));
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Not found' });
    await Rule.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Re-run rules on every transaction whose category you haven't set yourself
router.post('/apply', async (req, res, next) => {
  try {
    const rules = await Rule.find().lean();
    const txs = await Transaction.find({ parsed: true, categoryLocked: { $ne: true } });
    let updated = 0;
    for (const tx of txs) {
      await applyRules(tx, rules);
      if (tx.isModified('category')) { await tx.save(); updated++; }
    }
    res.json({ updated });
  } catch (e) { next(e); }
});

module.exports = router;
