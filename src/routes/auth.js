const router = require('express').Router();
const jwt = require('jsonwebtoken');
const config = require('../config');
const { safeEqual } = require('../middleware/auth');

// Basic brute-force protection: 10 failed attempts per IP per 15 minutes
const failures = new Map();
const WINDOW = 15 * 60 * 1000;

router.post('/login', (req, res) => {
  const ip = req.ip;
  const f = failures.get(ip);
  if (f && f.count >= 10 && Date.now() - f.first < WINDOW) {
    return res.status(429).json({ error: 'Too many attempts, try again later' });
  }
  if (!safeEqual(req.body?.password || '', config.appPassword)) {
    const cur = f && Date.now() - f.first < WINDOW ? f : { count: 0, first: Date.now() };
    cur.count++; failures.set(ip, cur);
    return res.status(401).json({ error: 'Wrong password' });
  }
  failures.delete(ip);
  const token = jwt.sign({ sub: 'owner' }, config.jwtSecret, { expiresIn: '30d' });
  res.cookie('token', token, {
    httpOnly: true, sameSite: 'strict', secure: config.secureCookies, maxAge: 30 * 24 * 3600 * 1000,
  });
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

module.exports = router;
