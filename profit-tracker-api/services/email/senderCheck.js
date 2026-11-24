// Sender check. An email is picked up because its From address is at a store's
// domain, and a From address can be faked. The user's mail provider already
// checked each email when it arrived (SPF, DKIM, DMARC) and wrote the result in
// an Authentication-Results header. An email is only read as a store's when
// that header says it really came from the From domain; otherwise it is kept
// as "ignored" and nothing is made or changed from it.
//
// Only the provider's own header counts. Anyone can put an
// Authentication-Results line in the email they send, so headers are trusted
// by who wrote them (the "authserv-id" at the start of the line):
//   Gmail          mx.google.com
//   iCloud         *.icloud.com   (one header per check)
//   Yahoo, AOL     *.yahoo.com / *.aol.com
// For "Other (IMAP)" the provider isn't known: the topmost header is used (the
// receiving server adds its own above everything the sender wrote). A provider
// that writes no such header at all can't be checked; its email is accepted,
// the same as before this check existed.
const AUTHSERV = {
  gmail: ['mx.google.com'],
  icloud: ['icloud.com'],
  yahoo: ['yahoo.com'],
  aol: ['yahoo.com', 'aol.com'],
};

const domainOf = (value) => String(value || '').toLowerCase().trim().replace(/^.*@/, '').replace(/[<>"\s]/g, '').replace(/\.$/, '');
const TWO_PART = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu']);
// The registered domain: orders.email.apple.com -> apple.com, shop.x.co.uk -> x.co.uk.
// DMARC compares these ("relaxed alignment").
function orgDomain(value) {
  const parts = domainOf(value).split('.').filter(Boolean);
  if (parts.length < 2) return null;
  const take = parts.length > 2 && parts[parts.length - 1].length === 2 && TWO_PART.has(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-take).join('.');
}
const sameOrg = (a, b) => Boolean(orgDomain(a)) && orgDomain(a) === orgDomain(b);
const within = (host, domain) => host === domain || host.endsWith(`.${domain}`);

// "Authentication-Results: mx.google.com; dkim=pass header.i=@x.com; dmarc=pass (p=NONE) header.from=x.com"
// -> { authserv: 'mx.google.com', results: [{ method: 'dkim', result: 'pass', props: { 'header.i': '@x.com' } }, ...] }
function parseHeader(line) {
  const text = String(line || '').replace(/^authentication-results:/i, '').replace(/\([^()]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const [first, ...rest] = text.split(';');
  const authserv = (first || '').trim().split(' ')[0].toLowerCase();
  if (!authserv || authserv.includes('=')) return null;
  const results = [];
  for (const part of rest) {
    const tokens = part.trim().split(' ').filter(Boolean);
    const head = (tokens.shift() || '').match(/^([a-z0-9-]+)=([a-z]+)$/i);
    if (!head) continue;
    const props = {};
    for (const t of tokens) {
      const eq = t.indexOf('=');
      if (eq > 0) props[t.slice(0, eq).toLowerCase()] = t.slice(eq + 1);
    }
    results.push({ method: head[1].toLowerCase(), result: head[2].toLowerCase(), props });
  }
  return { authserv, results };
}

/**
 * Did this email really come from its From domain, according to the mailbox
 * provider? headers: the email's Authentication-Results lines, topmost first.
 * Returns { ok, reason }.
 */
function checkSender({ fromAddress, headers = [], preset = 'other' }) {
  const from = domainOf(fromAddress);
  const parsed = headers.map(parseHeader).filter(Boolean);
  const known = AUTHSERV[preset];
  if (!parsed.length) {
    return known ? { ok: false, reason: 'no_result' } : { ok: true, reason: 'unchecked' };
  }
  let trusted = known ? parsed.filter((h) => known.some((d) => within(h.authserv, d))) : [];
  if (!trusted.length) {
    // Gmail always stamps its own header; without it, nothing here is Gmail's word.
    if (preset === 'gmail') return { ok: false, reason: 'no_result' };
    trusted = parsed.filter((h) => h.authserv === parsed[0].authserv);
  }
  const results = trusted.flatMap((h) => h.results);
  const dmarc = results.find((r) => r.method === 'dmarc');
  if (dmarc && dmarc.result === 'fail') return { ok: false, reason: 'dmarc_fail' };
  if (dmarc && ['pass', 'bestguesspass'].includes(dmarc.result)) {
    const claimed = dmarc.props['header.from'];
    return !claimed || sameOrg(claimed, from) ? { ok: true, reason: 'dmarc' } : { ok: false, reason: 'dmarc_other_domain' };
  }
  // No DMARC verdict (the domain publishes none): a signature or a sending
  // server that belongs to the From domain is the same proof.
  const dkim = results.some((r) => r.method === 'dkim' && r.result === 'pass' && sameOrg(r.props['header.d'] || r.props['header.i'], from));
  if (dkim) return { ok: true, reason: 'dkim' };
  const spf = results.some((r) => r.method === 'spf' && r.result === 'pass' && sameOrg(r.props['smtp.mailfrom'] || r.props['smtp.helo'], from));
  if (spf) return { ok: true, reason: 'spf' };
  return { ok: false, reason: 'not_verified' };
}

const UNVERIFIED_MESSAGE = "Your mail provider couldn't confirm this email really came from the store, so it was left alone.";

module.exports = { checkSender, parseHeader, orgDomain, UNVERIFIED_MESSAGE };
