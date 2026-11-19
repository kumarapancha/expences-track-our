const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    source: { type: String, enum: ['sms', 'manual'], required: true },

    // Original SMS, kept so old messages can be re-parsed when the parser improves
    sender: String,
    raw: String,
    rawHash: { type: String, index: { unique: true, sparse: true } },
    receivedAt: Date,
    parsed: { type: Boolean, default: true },
    pattern: String,

    type: { type: String, enum: ['debit', 'credit'] },
    amount: { type: Number, min: 0 },
    currency: { type: String, uppercase: true, trim: true, default: 'LKR' },
    account: String, // visible digits only, e.g. "3161"
    description: String,
    merchant: String,
    balance: Number,
    txnAt: { type: Date, index: true },

    category: { type: String, default: 'Uncategorized', trim: true },
    // Set when you pick a category yourself; rules never overwrite it
    categoryLocked: { type: Boolean, default: false },
    // Internal transfers and confirmed duplicates are kept but left out of totals
    excludeFromTotals: { type: Boolean, default: false },
    possibleDuplicateOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
    reviewed: { type: Boolean, default: false },
    notes: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model('Transaction', transactionSchema);
