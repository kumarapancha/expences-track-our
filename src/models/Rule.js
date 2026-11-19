const mongoose = require('mongoose');

// "If description or merchant contains <match>, set category to <category>"
const ruleSchema = new mongoose.Schema(
  {
    match: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Rule', ruleSchema);
