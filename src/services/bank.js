// Which bank a transaction belongs to, worked out from the account digits.
// Account **3009 is Sampath; every other account is NTB.
// Derived (not stored) so existing transactions are split correctly too.

const SAMPATH_ACCOUNT = '3009';
const BANKS = ['sampath', 'ntb'];

const isSampathAccount = (account) => !!account && String(account).endsWith(SAMPATH_ACCOUNT);

function bankOf(tx) {
  if (isSampathAccount(tx.account)) return 'sampath';
  // Unparsed SMS have no account yet; look at the raw text instead
  if (!tx.account && tx.raw && tx.raw.includes(`**${SAMPATH_ACCOUNT}`)) return 'sampath';
  return 'ntb';
}

// MongoDB filter matching bankOf(), for ?bank=sampath|ntb
function bankFilter(bank) {
  const sampath = {
    $or: [
      { account: { $regex: `${SAMPATH_ACCOUNT}$` } },
      { account: { $in: [null, ''] }, raw: { $regex: `\\*\\*${SAMPATH_ACCOUNT}` } },
    ],
  };
  if (bank === 'sampath') return sampath;
  if (bank === 'ntb') return { $nor: [sampath] };
  return {};
}

module.exports = { SAMPATH_ACCOUNT, BANKS, bankOf, bankFilter };
