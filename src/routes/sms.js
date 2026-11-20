const express = require('express');
const router = express.Router();
const config = require('../config');
const { requireApiKey } = require('../middleware/auth');
const { ingestSms } = require('../services/ingest');

// Called by MacroDroid. Accepts JSON, form fields or query params:
//   sender, body (or message), receivedAt (optional)
// Some phone apps send the SMS with no or an unusual Content-Type.
// Read any body that wasn't already parsed as JSON/form as plain text.
const anyText = express.text({ type: () => true, limit: '100kb' });

router.post('/', requireApiKey, anyText, async (req, res, next) => {
  try {
    const src = { ...req.query, ...(typeof req.body === 'object' ? req.body : {}) };
    const sender = (src.sender || '').toString().trim();
    const body = (src.body || src.message || (typeof req.body === 'string' ? req.body : '')).toString();
    if (!body.trim()) {
      return res.status(400).json({
        error: 'SMS body is required',
        hint: 'Send the SMS text as the request body, or as a "body" parameter',
        received: { contentType: req.get('content-type') || null, queryKeys: Object.keys(req.query) },
      });
    }

    if (config.allowedSenders.length && !config.allowedSenders.includes(sender.toUpperCase())) {
      return res.status(202).json({ ignored: true, reason: 'sender not in ALLOWED_SENDERS' });
    }

    const { tx, created, ignored } = await ingestSms({ sender, body, receivedAt: src.receivedAt });
    if (ignored) {
      return res.status(202).json({ ignored: true, reason: 'not a recognised Sampath or NTB transaction SMS' });
    }
    res.status(created ? 201 : 200).json({
      id: tx._id, created, parsed: tx.parsed, possibleDuplicate: !!tx.possibleDuplicateOf,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
