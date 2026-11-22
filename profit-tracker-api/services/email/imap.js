// A narrow, read-only IMAP reader. It can list folders, open a folder
// read-only (EXAMINE), search by sender and date, and read message headers
// (envelopes). Nothing here can flag, move, delete, append or send mail, and
// envelope fetches never set \Seen. The sync code only sees this interface,
// so tests swap in a fake server without touching a real mailbox.
const { ImapFlow } = require('imapflow');
const { userError } = require('./hostCheck');

const TIMEOUTS = { connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 60000 };

// What the user sees when a connection fails. The server's own reply and the
// password never appear in it.
function friendlyError(err) {
  if (err?.userFacing) return err.message;
  if (err?.authenticationFailed) {
    return "The mail server didn't accept that email and password. Gmail, iCloud, Yahoo and AOL need an app password, not your normal password.";
  }
  const code = err?.code || err?.cause?.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'That mail server name could not be found.';
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET') return 'The mail server refused the connection. Check the server name.';
  if (code === 'ETIMEDOUT' || /timeout/i.test(err?.message || '')) return 'The mail server took too long to answer. Try again in a minute.';
  if (/certificate|CERT_|self.signed/i.test(`${code} ${err?.message}`)) return "The mail server's security certificate doesn't match its name.";
  return 'Could not read this mailbox. Try again later.';
}

// target: { address, servername, port, user, pass }. `address` is the IP the
// host check resolved; TLS still verifies the certificate against servername.
async function openImap(target, { ImapClass = ImapFlow } = {}) {
  const client = new ImapClass({
    host: target.address,
    servername: target.servername,
    port: target.port,
    secure: true,
    auth: { user: target.user, pass: target.pass },
    logger: false,
    emitLogs: false,
    disableAutoIdle: true,
    ...TIMEOUTS,
  });
  client.on?.('error', () => {}); // socket errors surface through the awaited calls
  await client.connect();
  let lock = null;

  return {
    async listFolders() {
      const list = await client.list();
      return list.map((f) => ({ path: f.path, specialUse: f.specialUse || null }));
    },
    async openReadOnly(path) {
      if (lock) { lock.release(); lock = null; }
      lock = await client.getMailboxLock(path, { readOnly: true });
      const box = client.mailbox || {};
      return { uidValidity: box.uidValidity != null ? String(box.uidValidity) : null, exists: box.exists || 0 };
    },
    // { domains: [...], since: Date, afterUid: n } -> ascending UIDs > afterUid
    async searchUids({ domains, since, afterUid = 0 }) {
      const query = { since };
      if (domains.length === 1) query.from = domains[0];
      else query.or = domains.map((d) => ({ from: d }));
      if (afterUid > 0) query.uid = `${afterUid + 1}:*`;
      const uids = await client.search(query, { uid: true });
      if (!Array.isArray(uids)) return [];
      // "N:*" always includes the newest message even when its UID is below N.
      return uids.filter((u) => u > afterUid).sort((a, b) => a - b);
    },
    async fetchHeaders(uids) {
      if (!uids.length) return [];
      const out = [];
      for await (const msg of client.fetch(uids.join(','), { uid: true, envelope: true }, { uid: true })) {
        const env = msg.envelope || {};
        const from = env.from?.[0] || {};
        out.push({
          uid: msg.uid,
          messageId: env.messageId || null,
          fromAddress: String(from.address || '').toLowerCase(),
          fromName: from.name || null,
          subject: env.subject || null,
          date: env.date ? new Date(env.date) : null,
        });
      }
      return out;
    },
    // Raw source for reading order details, capped at 512 KB per email.
    // BODY.PEEK: reading the body never marks the email as read.
    async fetchSources(uids, { maxLength = 512 * 1024 } = {}) {
      if (!uids.length) return [];
      const out = [];
      for await (const msg of client.fetch(uids.join(','), { uid: true, source: { maxLength } }, { uid: true })) {
        if (msg.source) out.push({ uid: msg.uid, source: msg.source });
      }
      return out;
    },
    // After a folder is renumbered, find an email again by its Message-ID.
    async findUidByMessageId(messageId) {
      if (!messageId) return null;
      const uids = await client.search({ header: { 'message-id': messageId } }, { uid: true });
      return Array.isArray(uids) && uids.length ? Math.max(...uids) : null;
    },
    async close() {
      try { if (lock) lock.release(); } catch { /* already gone */ }
      lock = null;
      try { await client.logout(); } catch { try { client.close(); } catch { /* closed */ } }
    },
  };
}

module.exports = { openImap, friendlyError, userError };
