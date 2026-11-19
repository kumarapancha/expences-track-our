const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function requireLogin(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  try {
    jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired' });
  }
}

function requireApiKey(req, res, next) {
  const key = req.get('x-api-key') || req.query.key;
  if (!key || !safeEqual(key, config.smsApiKey)) return res.status(401).json({ error: 'Invalid API key' });
  next();
}

module.exports = { requireLogin, requireApiKey, safeEqual };
