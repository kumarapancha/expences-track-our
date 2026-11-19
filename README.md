# Expense Tracker

A personal expense tracker. Your Android phone forwards each bank SMS to this site, which parses it and shows monthly spending.

```
Bank SMS → Android (MacroDroid) → POST /api/sms → Express → MongoDB → website
```

## Run locally

```bash
npm install
cp .env.example .env      # fill in the values
npm run dev               # http://localhost:3000
```

To generate `JWT_SECRET` and `SMS_API_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Send a test SMS:

```bash
curl -X POST http://localhost:3000/api/sms \
  -H "x-api-key: YOUR_SMS_API_KEY" \
  --data-urlencode "sender=BANK" \
  --data-urlencode $'body=LKR 1,250.00 debited from AC **3009 via POS at KEELLS SUPER\n20/11/2026 18:30:00'
```

## Deploy (free tiers)

1. **MongoDB Atlas.** Create a free M0 cluster, add a database user, and allow network access from `0.0.0.0/0`. Copy the connection string into `MONGODB_URI`.
2. **Render.** Create a new Web Service from your GitHub repo.
   - Build command: `npm install`
   - Start command: `npm start`
   - Environment: `MONGODB_URI`, `APP_PASSWORD`, `JWT_SECRET`, `SMS_API_KEY`, `NODE_ENV=production`
3. Open `https://<your-app>.onrender.com` and log in with `APP_PASSWORD`.

Render's free tier puts the app to sleep after about 15 minutes with no traffic. The first SMS after it sleeps can take 30–60 seconds while it wakes up. MacroDroid waits for the response, so the SMS still gets saved.

## Phone setup (MacroDroid)

1. Install **MacroDroid** from the Play Store and allow the SMS permission.
2. Add a macro:
   - **Trigger:** SMS Received. Set *Any number* to each of your bank sender IDs, as shown in your SMS app. You can add one trigger per bank.
   - **Action:** HTTP Request (in the Web Interactions group).
     - Method: `POST`
     - URL: `https://<your-app>.onrender.com/api/sms`
     - Header: `x-api-key` = your `SMS_API_KEY`
     - Body: **form / query parameters** with URL encoding turned on:
       - `sender` = `[sms_number]`
       - `body` = `[sms_message]`
3. Test it by sending yourself an SMS in the same format.

Use form parameters rather than a hand-typed JSON body. Bank SMS contain line breaks, which break JSON unless they're escaped. Menu names can differ slightly between MacroDroid versions; the "magic text" variables for the sender and message are what you need.

## How it works

- **Parser** (`src/services/smsParser.js`) handles 3 formats:
  - `LKR … credited/debited … AC **3009` + date
  - `… was performed on your Account No. … DR/CR. Current Bal …` (no time in the SMS, so the received time is used)
  - `Funds successfully transferred! … on 16 November 2026 07:13 PM`

  Unknown SMS are saved as **unparsed** and appear under *Review*. Open one, fill in the amount and type, and save. To support a new format, add a pattern and a test in `test/parser.test.js`.
- **Duplicates.** If a debit with the same amount and currency arrives in a *different* format within 15 minutes (for example, the CEFTS SMS plus the "Funds transferred" SMS), the second one is flagged and left out of totals. Use *Not a duplicate* if it was a real second transaction.
- **Currencies** are never added together. Each currency gets its own card.
- **Internal transfers.** Set the category to `Internal Transfer`, for example SGD account → LKR account. These are left out of totals.
- **Rules.** For example `KEELLS → Groceries`. New SMS are categorised automatically. *Apply to existing* updates older transactions, but never a category you picked yourself.
- **Raw SMS** text is always stored, so old messages can be re-parsed later.
- **Re-sending the same SMS** does nothing. It's identified by a hash of sender + text, so MacroDroid retries are safe.

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/sms` | `x-api-key` | Ingest an SMS (`sender`, `body`, optional `receivedAt`) |
| POST | `/api/auth/login` | – | `{ password }` sets a session cookie |
| GET | `/api/summary?month=YYYY-MM` | cookie | Totals per currency + by category |
| GET | `/api/transactions?month=&currency=&type=&category=&q=&review=1` | cookie | List |
| POST | `/api/transactions` | cookie | Manual entry (cash etc.) |
| PATCH / DELETE | `/api/transactions/:id` | cookie | Edit / delete |
| GET / POST / DELETE | `/api/rules`, `POST /api/rules/apply` | cookie | Category rules |

## Tests

```bash
npm test                                                              # parser tests
TEST_MONGODB_URI=mongodb://127.0.0.1:27017/expenses_test npm test     # + API tests (drops that DB)
```
