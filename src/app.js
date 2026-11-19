const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { requireLogin } = require('./middleware/auth');

function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind Render/Railway proxy
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(express.text({ type: 'text/plain', limit: '100kb' }));
  app.use(cookieParser());

  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/sms', require('./routes/sms'));
  app.use('/api/transactions', requireLogin, require('./routes/transactions'));
  app.use('/api/summary', requireLogin, require('./routes/summary'));
  app.use('/api/rules', requireLogin, require('./routes/rules'));

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use((err, req, res, next) => {
    if (err.name === 'ValidationError' || err.name === 'CastError') {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  });
  return app;
}

module.exports = { createApp };
