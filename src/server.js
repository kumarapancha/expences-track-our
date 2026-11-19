const mongoose = require('mongoose');
const config = require('./config');
const { createApp } = require('./app');

mongoose.set('strictQuery', true);

mongoose.connect(config.mongoUri).then(() => {
  createApp().listen(config.port, () => console.log(`Expense tracker on http://localhost:${config.port}`));
}).catch((err) => {
  console.error('MongoDB connection failed:', err.message);
  process.exit(1);
});
