require('dotenv').config();

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return v;
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  mongoUri: required('MONGODB_URI'),
  appPassword: required('APP_PASSWORD'),
  jwtSecret: required('JWT_SECRET'),
  smsApiKey: required('SMS_API_KEY'),
  // Optional comma-separated sender IDs. Empty = accept all senders.
  allowedSenders: (process.env.ALLOWED_SENDERS || '')
    .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
  timezone: 'Asia/Colombo',
  tzOffset: '+05:30',
  secureCookies: process.env.NODE_ENV === 'production',
};
