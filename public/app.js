const TZ = 'Asia/Colombo';
const TZ_OFFSET = '+05:30';
const DEFAULT_CATEGORIES = [
  'Groceries', 'Dining', 'Transport', 'Fuel', 'Utilities', 'Bills', 'Rent / Land Instalment',
  'Shopping', 'Health', 'Education', 'Baby', 'Family', 'Entertainment', 'Cash Withdrawal',
  'Bank Charges', 'Loan Repayment', 'Transfer', 'Internal Transfer', 'Income',
  'Income (Foreign Transfer)', 'Uncategorized', 'Other',
];

const $ = (id) => document.getElementById(id);
const state = { month: currentMonth(), summary: null, rows: [], review: false, editing: null };

// ---------- helpers ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && !path.startsWith('/api/auth')) { showLogin(); throw new Error('Not logged in'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function currentMonth() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return `${p.find((x) => x.type === 'year').value}-${p.find((x) => x.type === 'month').value}`;
}
function shiftMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const money = (n, cur) =>
  `${cur || ''} ${Number(n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
const fmtDate = (d) => {
  const x = new Date(d);
  const day = x.toLocaleDateString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short' });
  const time = x.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  return `${day}\n${time}`;
};
function toLocalInput(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n[k] = v;
  }
  for (const c of children) if (c != null) n.append(c);
  return n;
}
function fillSelect(select, values, firstLabel) {
  const cur = select.value;
  select.replaceChildren(...(firstLabel != null ? [el('option', { value: '', textContent: firstLabel })] : []),
    ...values.map((v) => el('option', { value: v, textContent: v })));
  if ([...select.options].some((o) => o.value === cur)) select.value = cur;
}

// ---------- auth ----------
function showLogin() { $('app').classList.add('hidden'); $('login').classList.remove('hidden'); $('password').focus(); }
function showApp() { $('login').classList.add('hidden'); $('app').classList.remove('hidden'); }

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginError').textContent = '';
  try {
    await api('/api/auth/login', { method: 'POST', body: { password: $('password').value } });
    $('password').value = '';
    showApp();
    load();
  } catch (err) { $('loginError').textContent = err.message; }
});
$('logoutBtn').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); showLogin(); });

// ---------- data ----------
async function load() {
  $('month').value = state.month;
  const [summary, rows] = await Promise.all([
    api(`/api/summary?month=${state.month}`),
    api(state.review ? '/api/transactions?review=1' : `/api/transactions?month=${state.month}`),
  ]);
  state.summary = summary;
  state.rows = rows;
  showApp();
  render();
}

function render() {
  const { currencies, needsReview } = state.summary;

  // review banner
  $('reviewBanner').classList.toggle('hidden', !needsReview && !state.review);
  $('reviewText').textContent = state.review
    ? 'Showing items that need review (unparsed SMS and possible duplicates).'
    : `${needsReview} item${needsReview === 1 ? '' : 's'} need review.`;
  $('reviewBtn').textContent = state.review ? 'Back to month' : 'Review';
  $('listTitle').textContent = state.review ? 'Needs review' : 'Transactions';

  // currency cards (currencies are never added together)
  $('cards').replaceChildren(...(currencies.length ? currencies.map((c) => el('div', { class: 'card stat' },
    el('div', { class: 'cur', textContent: c.currency }),
    el('div', { class: 'row' }, el('span', { class: 'muted', textContent: 'Spent' }),
      el('span', { class: 'big debit', textContent: money(c.spent) })),
    el('div', { class: 'row' }, el('span', { class: 'muted', textContent: 'Received' }),
      el('span', { class: 'credit', textContent: money(c.received) })),
    el('div', { class: 'row' }, el('span', { class: 'muted', textContent: 'Net' }),
      el('span', { textContent: money(c.net) })),
  )) : [el('div', { class: 'card muted', textContent: 'No transactions this month yet.' })]));

  // category breakdown
  fillSelect($('catCurrency'), currencies.map((c) => c.currency));
  renderCategories();

  // filters
  const allCurrencies = [...new Set([...currencies.map((c) => c.currency), ...state.rows.map((r) => r.currency).filter(Boolean)])];
  fillSelect($('fCurrency'), allCurrencies, 'All currencies');
  const cats = [...new Set([...DEFAULT_CATEGORIES, ...state.rows.map((r) => r.category).filter(Boolean)])].sort();
  fillSelect($('fCategory'), cats, 'All categories');
  $('categoryList').replaceChildren(...cats.map((c) => el('option', { value: c })));

  renderRows();
}

function renderCategories() {
  const c = state.summary.currencies.find((x) => x.currency === $('catCurrency').value);
  if (!c || !c.categories.length) {
    $('categories').replaceChildren(el('p', { class: 'muted', textContent: 'No spending yet.' }));
    return;
  }
  const max = c.categories[0].amount;
  $('categories').replaceChildren(...c.categories.map((x) => el('div', { class: 'cat' },
    el('div', { class: 'line' }, el('span', { textContent: x.category }), el('span', { textContent: money(x.amount) })),
    el('div', { class: 'track' }, el('div', { class: 'fill', style: `width:${(x.amount / max) * 100}%` })),
  )));
}

function renderRows() {
  const q = $('search').value.trim().toUpperCase();
  const cur = $('fCurrency').value, type = $('fType').value, cat = $('fCategory').value;
  const rows = state.rows.filter((r) =>
    (!cur || r.currency === cur) && (!type || r.type === type) && (!cat || r.category === cat) &&
    (!q || `${r.description || ''} ${r.merchant || ''} ${r.raw || ''} ${r.notes || ''}`.toUpperCase().includes(q)));

  $('empty').classList.toggle('hidden', rows.length > 0);
  $('rows').replaceChildren(...rows.map((r) => {
    const desc = r.parsed ? (r.description || r.merchant || '(no description)') : (r.raw || '').slice(0, 80);
    const tags = [];
    if (!r.parsed) tags.push(el('span', { class: 'tag', textContent: 'unparsed' }));
    if (r.possibleDuplicateOf && !r.reviewed) tags.push(el('span', { class: 'tag', textContent: 'possible duplicate' }));
    if (r.source === 'manual') tags.push(el('span', { class: 'tag', textContent: 'manual' }));
    const sub = [r.account ? `acct …${r.account}` : null, r.balance != null ? `bal ${money(r.balance, r.currency)}` : null]
      .filter(Boolean).join(' · ');
    return el('tr', { class: r.excludeFromTotals ? 'excluded' : '', onclick: () => openEdit(r) },
      el('td', { textContent: fmtDate(r.txnAt) }),
      el('td', {}, el('div', {}, desc, ...tags), sub ? el('div', { class: 'sub', textContent: sub }) : null,
        el('div', { class: 'sub cat-inline', textContent: r.category || '' })),
      el('td', { textContent: r.category || '' }),
      el('td', { class: `num ${r.type || ''}`, textContent: r.amount != null ? `${r.type === 'debit' ? '−' : '+'}${money(r.amount, r.currency)}` : '—' }),
    );
  }));
}

// ---------- edit / add ----------
const form = $('editForm');

function openEdit(tx) {
  state.editing = tx;
  form.reset();
  $('editError').textContent = '';
  $('editTitle').textContent = tx ? 'Edit transaction' : 'Add transaction';
  $('deleteBtn').classList.toggle('hidden', !tx);
  $('editRaw').classList.toggle('hidden', !tx?.raw);
  $('editRaw').textContent = tx?.raw || '';
  const dup = tx?.possibleDuplicateOf && !tx.reviewed;
  $('dupNote').classList.toggle('hidden', !dup);
  $('dupNote').textContent = 'This looks like a second SMS for a transaction already recorded (same amount within 15 minutes). It is left out of totals.';
  $('notDupBtn').classList.toggle('hidden', !dup);

  const t = tx || { type: 'debit', currency: 'LKR', txnAt: new Date(), category: '' };
  form.type.value = t.type || 'debit';
  form.amount.value = t.amount ?? '';
  form.currency.value = t.currency || 'LKR';
  form.txnAt.value = toLocalInput(t.txnAt || new Date());
  form.description.value = t.description || '';
  form.category.value = t.category === 'Uncategorized' ? '' : (t.category || '');
  form.account.value = t.account || '';
  form.notes.value = t.notes || '';
  form.excludeFromTotals.checked = !!t.excludeFromTotals;
  $('editDialog').showModal();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    type: form.type.value,
    amount: Number(form.amount.value),
    currency: form.currency.value.trim().toUpperCase(),
    txnAt: `${form.txnAt.value}:00${TZ_OFFSET}`,
    description: form.description.value.trim(),
    category: form.category.value.trim() || 'Uncategorized',
    account: form.account.value.trim(),
    notes: form.notes.value.trim(),
    excludeFromTotals: form.excludeFromTotals.checked,
  };
  if (state.editing) body.reviewed = true; // saving an item means you've looked at it
  try {
    if (state.editing) await api(`/api/transactions/${state.editing._id}`, { method: 'PATCH', body });
    else await api('/api/transactions', { method: 'POST', body });
    $('editDialog').close();
    load();
  } catch (err) { $('editError').textContent = err.message; }
});

$('notDupBtn').addEventListener('click', async () => {
  try {
    await api(`/api/transactions/${state.editing._id}`, {
      method: 'PATCH', body: { possibleDuplicateOf: null, excludeFromTotals: false, reviewed: true },
    });
    $('editDialog').close();
    load();
  } catch (err) { $('editError').textContent = err.message; }
});

$('deleteBtn').addEventListener('click', async () => {
  if (!state.editing) return;
  $('deleteBtn').textContent === 'Confirm delete'
    ? await api(`/api/transactions/${state.editing._id}`, { method: 'DELETE' }).then(() => { $('editDialog').close(); load(); })
      .catch((err) => { $('editError').textContent = err.message; })
    : ($('deleteBtn').textContent = 'Confirm delete');
});
$('editDialog').addEventListener('close', () => { $('deleteBtn').textContent = 'Delete'; });
$('cancelBtn').addEventListener('click', () => $('editDialog').close());
$('addBtn').addEventListener('click', () => openEdit(null));

// ---------- rules ----------
async function loadRules() {
  const rules = await api('/api/rules');
  $('ruleList').replaceChildren(...(rules.length ? rules.map((r) => el('li', {},
    el('span', { textContent: `“${r.match}” → ${r.category}` }),
    el('button', { class: 'ghost', textContent: 'Remove', onclick: async () => { await api(`/api/rules/${r._id}`, { method: 'DELETE' }); loadRules(); } }),
  )) : [el('li', { class: 'muted', textContent: 'No rules yet.' })]));
}
$('rulesBtn').addEventListener('click', () => { $('rulesMsg').textContent = ''; loadRules(); $('rulesDialog').showModal(); });
$('closeRulesBtn').addEventListener('click', () => { $('rulesDialog').close(); load(); });
$('ruleForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/api/rules', { method: 'POST', body: { match: f.match.value, category: f.category.value } });
    f.reset();
    loadRules();
  } catch (err) { $('rulesMsg').textContent = err.message; }
});
$('applyRulesBtn').addEventListener('click', async () => {
  const { updated } = await api('/api/rules/apply', { method: 'POST' });
  $('rulesMsg').textContent = `${updated} transaction${updated === 1 ? '' : 's'} updated.`;
});

// ---------- controls ----------
$('month').addEventListener('change', () => { if ($('month').value) { state.month = $('month').value; state.review = false; load(); } });
$('prevMonth').addEventListener('click', () => { state.month = shiftMonth(state.month, -1); state.review = false; load(); });
$('nextMonth').addEventListener('click', () => { state.month = shiftMonth(state.month, 1); state.review = false; load(); });
$('reviewBtn').addEventListener('click', () => { state.review = !state.review; load(); });
$('catCurrency').addEventListener('change', renderCategories);
for (const id of ['search', 'fCurrency', 'fType', 'fCategory']) $(id).addEventListener('input', renderRows);

load().catch(() => {});
