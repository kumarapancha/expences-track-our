const router = require('express').Router();
const config = require('../config');
const { requireApiKey } = require('../middleware/auth');
const { ingestSms } = require('../services/ingest');

// Called by MacroDroid. Accepts JSON, form fields or query params:
//   sender, body (or message), receivedAt (optional)
router.post('/', requireApiKey, async (req, res, next) => {
  try {
    const src = { ...req.query, ...(typeof req.body === 'object' ? req.body : {}) };
    const sender = (src.sender || '').toString().trim();
    const body = (src.body || src.message || (typeof req.body === 'string' ? req.body : '')).toString();
    if (!body.trim()) return res.status(400).json({ error: 'SMS body is required' });

    if (config.allowedSenders.length && !config.allowedSenders.includes(sender.toUpperCase())) {
      return res.status(202).json({ ignored: true, reason: 'sender not in ALLOWED_SENDERS' });
    }

    const { tx, created } = await ingestSms({ sender, body, receivedAt: src.receivedAt });
    res.status(created ? 201 : 200).json({
      id: tx._id, created, parsed: tx.parsed, possibleDuplicate: !!tx.possibleDuplicateOf,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
