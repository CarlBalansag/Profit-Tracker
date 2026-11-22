// Email connections: provider presets and the sender allow-list.
// Only mail FROM these senders is ever searched for or downloaded, so a
// user's unrelated personal email never leaves their mail server.

// Implicit-TLS IMAP only (port 993). Hosts are fixed for the presets; "other"
// takes a host the user types, checked by hostCheck.js before any connection.
const PRESETS = {
  gmail: {
    label: 'Gmail', host: 'imap.gmail.com', port: 993,
    help: 'Turn on 2-Step Verification, then create an app password.',
    helpUrl: 'https://myaccount.google.com/apppasswords',
    spamFolders: ['[Gmail]/Spam', '[Google Mail]/Spam'],
  },
  icloud: {
    label: 'iCloud Mail', host: 'imap.mail.me.com', port: 993, maxConnections: 3,
    help: 'Create an app-specific password in your Apple Account.',
    helpUrl: 'https://account.apple.com/account/manage',
    spamFolders: ['Junk'],
  },
  yahoo: {
    label: 'Yahoo Mail', host: 'imap.mail.yahoo.com', port: 993,
    help: 'Create an app password in Yahoo Account Security.',
    helpUrl: 'https://login.yahoo.com/myaccount/security/app-password',
    spamFolders: ['Bulk', 'Bulk Mail', 'Spam'],
  },
  aol: {
    label: 'AOL Mail', host: 'imap.aol.com', port: 993,
    help: 'Create an app password in AOL Account Security.',
    helpUrl: 'https://login.aol.com/account/security',
    spamFolders: ['Bulk', 'Bulk Mail', 'Spam'],
  },
  other: {
    label: 'Other (IMAP)', host: null, port: 993,
    help: "Use your provider's IMAP server name, and an app password if it offers one.",
    helpUrl: null,
    spamFolders: ['Junk', 'Spam', 'INBOX.Junk', 'INBOX.Spam'],
  },
};

// Searched with IMAP "FROM <domain>", which matches any address at that
// domain or its subdomains (auto-confirm@amazon.com, orders@email.apple.com).
const SENDERS = [
  { key: 'amazon', label: 'Amazon', domains: ['amazon.com'] },
  { key: 'walmart', label: 'Walmart', domains: ['walmart.com'] },
  { key: 'bestbuy', label: 'Best Buy', domains: ['bestbuy.com'] },
  { key: 'target', label: 'Target', domains: ['target.com'] },
  { key: 'apple', label: 'Apple', domains: ['apple.com'] },
  { key: 'costco', label: 'Costco', domains: ['costco.com'] },
  { key: 'samsclub', label: "Sam's Club", domains: ['samsclub.com'] },
  { key: 'homedepot', label: 'Home Depot', domains: ['homedepot.com'] },
  { key: 'lowes', label: "Lowe's", domains: ['lowes.com'] },
  { key: 'gamestop', label: 'GameStop', domains: ['gamestop.com'] },
  { key: 'nike', label: 'Nike', domains: ['nike.com'] },
  { key: 'ebay', label: 'eBay', domains: ['ebay.com'] },
  { key: 'stockx', label: 'StockX', domains: ['stockx.com'] },
  { key: 'goat', label: 'GOAT', domains: ['goat.com'] },
  { key: 'paypal', label: 'PayPal', domains: ['paypal.com'] },
  { key: 'pirateship', label: 'Pirate Ship', domains: ['pirateship.com'] },
  { key: 'ups', label: 'UPS', domains: ['ups.com'] },
  { key: 'fedex', label: 'FedEx', domains: ['fedex.com'] },
  { key: 'usps', label: 'USPS', domains: ['usps.com'] },
];

// The sender's address must be at the domain or a subdomain. IMAP's FROM
// search is a loose substring match, so this check is what decides.
function merchantFor(address) {
  const at = String(address || '').toLowerCase().trim().split('@');
  if (at.length !== 2 || !at[1]) return null;
  const domain = at[1];
  for (const sender of SENDERS) {
    if (sender.domains.some((d) => domain === d || domain.endsWith(`.${d}`))) return sender.key;
  }
  return null;
}

function normalizeHost(host) {
  let h = String(host || '').trim().toLowerCase().replace(/\.$/, '');
  if (h === 'imap.googlemail.com') h = 'imap.gmail.com';
  return h;
}

// iCloud signs in with the full address; a bare name is a common mistake.
function loginName(preset, username, email) {
  const user = String(username || '').trim();
  const address = String(email || '').trim().toLowerCase();
  if (preset === 'icloud' && user && !user.includes('@')) return address;
  return user || address;
}

module.exports = { PRESETS, SENDERS, merchantFor, normalizeHost, loginName };
