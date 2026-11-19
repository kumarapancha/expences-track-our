const { tzOffset } = require('../config');

// "2026-11" -> start/end of that month in Sri Lanka time
function monthRange(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(month || '');
  if (!m || +m[2] < 1 || +m[2] > 12) return null;
  const y = +m[1], mo = +m[2];
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  return {
    start: new Date(`${month}-01T00:00:00${tzOffset}`),
    end: new Date(`${next}-01T00:00:00${tzOffset}`),
  };
}

module.exports = { monthRange };
