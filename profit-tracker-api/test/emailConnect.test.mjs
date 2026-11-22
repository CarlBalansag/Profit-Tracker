// Email connections (E1): sender allow-list, password encryption, the public
// host check, and the IMAP reader staying read-only.
import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { merchantFor, normalizeHost, loginName } = require('../services/email/config.js');
const { encryptSecret, decryptSecret, configured } = require('../services/email/crypto.js');
const { resolvePublicHost, privateAddress } = require('../services/email/hostCheck.js');
const { openImap, friendlyError } = require('../services/email/imap.js');
const { dedupeKey, foldersToRead } = require('../services/email/sync.js');

const KEY = 'a'.repeat(64);

describe('sender allow-list', () => {
  it('matches the domain or a subdomain, never a look-alike', () => {
    expect(merchantFor('auto-confirm@amazon.com')).toBe('amazon');
    expect(merchantFor('Orders@Email.Apple.com')).toBe('apple');
    expect(merchantFor('deals@notamazon.com')).toBe(null);
    expect(merchantFor('amazon.com@phish.example')).toBe(null);
    expect(merchantFor('friend@gmail.com')).toBe(null);
    expect(merchantFor('')).toBe(null);
  });
  it('fixes the usual host and username slips', () => {
    expect(normalizeHost(' IMAP.GoogleMail.com. ')).toBe('imap.gmail.com');
    expect(loginName('icloud', 'jane', 'Jane@iCloud.com')).toBe('jane@icloud.com');
    expect(loginName('gmail', '', 'me@gmail.com')).toBe('me@gmail.com');
  });
});

describe('password encryption', () => {
  afterEach(() => { delete process.env.EMAIL_TOKEN_KEY; });
  it('round-trips with a version tag and a fresh IV each time', () => {
    process.env.EMAIL_TOKEN_KEY = KEY;
    const a = encryptSecret('abcd efgh ijkl mnop');
    const b = encryptSecret('abcd efgh ijkl mnop');
    expect(a.startsWith('v1:')).toBe(true);
    expect(a).not.toBe(b);
    expect(a).not.toContain('abcd');
    expect(decryptSecret(a)).toBe('abcd efgh ijkl mnop');
  });
  it('refuses tampered values and a missing key', () => {
    process.env.EMAIL_TOKEN_KEY = KEY;
    const parts = encryptSecret('secret').split(':');
    parts[2] = Buffer.from('other').toString('base64');
    expect(() => decryptSecret(parts.join(':'))).toThrow();
    delete process.env.EMAIL_TOKEN_KEY;
    expect(configured()).toBe(false);
    expect(() => encryptSecret('x')).toThrow(/not set up/);
  });
});

describe('public host check', () => {
  it('refuses private, loopback and link-local addresses', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.20.1.1', '192.168.1.5', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(privateAddress(ip), ip).toBe(true);
    }
    expect(privateAddress('142.250.1.108')).toBe(false);
    expect(privateAddress('2607:f8b0:4004:c1b::6c')).toBe(false);
  });
  it('accepts only public DNS names and returns the checked address', async () => {
    const lookup = async (host) => (host === 'imap.example.com' ? [{ address: '93.184.216.34' }] : [{ address: '10.1.1.1' }]);
    await expect(resolvePublicHost('imap.example.com', lookup)).resolves.toBe('93.184.216.34');
    await expect(resolvePublicHost('internal.example.com', lookup)).rejects.toThrow(/public internet/);
    await expect(resolvePublicHost('127.0.0.1', lookup)).rejects.toThrow(/server name/);
    await expect(resolvePublicHost('localhost', lookup)).rejects.toThrow(/server name/);
    await expect(resolvePublicHost('gone.example.com', async () => { throw new Error('ENOTFOUND'); })).rejects.toThrow(/could not be found/);
  });
});

describe('friendly errors', () => {
  it('explains a rejected password without echoing the server', () => {
    const msg = friendlyError(Object.assign(new Error('NO [AUTHENTICATIONFAILED] Invalid credentials (Failure) user=me pass=hunter2'), { authenticationFailed: true }));
    expect(msg).toMatch(/app password/);
    expect(msg).not.toMatch(/hunter2|Invalid credentials/);
    expect(friendlyError(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }))).toMatch(/too long/);
  });
});

describe('dedupe keys and folders', () => {
  it('keys on Message-ID across accounts, else on the account and headers', () => {
    const h = { messageId: '<ABC@amazon.com>', fromAddress: 'a@amazon.com', subject: 'Order', date: new Date('2026-01-02T00:00:00Z') };
    expect(dedupeKey('acct-1', h)).toBe(dedupeKey('acct-2', { ...h, messageId: '<abc@amazon.com>' }));
    const bare = { ...h, messageId: null };
    expect(dedupeKey('acct-1', bare)).not.toBe(dedupeKey('acct-2', bare));
    expect(dedupeKey('acct-1', bare)).toBe(dedupeKey('acct-1', { ...bare }));
  });
  it('reads INBOX only unless spam is on, then finds spam folders by name or flag', () => {
    const listed = [{ path: 'INBOX' }, { path: '[Gmail]/Spam', specialUse: '\\Junk' }, { path: 'Bulk Mail' }, { path: 'Receipts' }];
    expect(foldersToRead('gmail', false, listed)).toEqual(['INBOX']);
    expect(foldersToRead('gmail', true, listed)).toEqual(['INBOX', '[Gmail]/Spam', 'Bulk Mail']);
    expect(foldersToRead('yahoo', true, [])).toEqual(['INBOX', 'Bulk', 'Bulk Mail', 'Spam']);
  });
});

// A stand-in for imapflow that records every call and fails on anything that
// could change a mailbox.
class FakeImapFlow {
  static last = null;
  constructor(options) { this.options = options; this.calls = []; FakeImapFlow.last = this; this.mailbox = null; }
  on() {}
  async connect() { this.calls.push('connect'); }
  async list() { return [{ path: 'INBOX' }]; }
  async getMailboxLock(path, opts) { this.calls.push(['lock', path, opts]); this.mailbox = { uidValidity: 7n, exists: 3 }; return { release: () => this.calls.push('release') }; }
  async search(query, opts) { this.calls.push(['search', query, opts]); return [3, 9, 12]; }
  async *fetch(range, query, opts) {
    this.calls.push(['fetch', range, query, opts]);
    yield { uid: 9, envelope: { messageId: '<m9@amazon.com>', from: [{ address: 'Auto-Confirm@Amazon.com', name: 'Amazon.com' }], subject: 'Your order', date: '2026-03-01T10:00:00Z' } };
  }
  async logout() { this.calls.push('logout'); }
  close() {}
  messageFlagsAdd() { throw new Error('must not flag'); }
  messageFlagsSet() { throw new Error('must not flag'); }
  messageMove() { throw new Error('must not move'); }
  messageCopy() { throw new Error('must not copy'); }
  messageDelete() { throw new Error('must not delete'); }
  append() { throw new Error('must not append'); }
  mailboxOpen() { throw new Error('must use a read-only lock'); }
}

describe('IMAP reader', () => {
  it('connects by checked address with TLS to the real name, and only reads', async () => {
    const reader = await openImap({ address: '93.184.216.34', servername: 'imap.gmail.com', port: 993, user: 'me@gmail.com', pass: 'app-pass' }, { ImapClass: FakeImapFlow });
    const fake = FakeImapFlow.last;
    expect(fake.options).toMatchObject({ host: '93.184.216.34', servername: 'imap.gmail.com', port: 993, secure: true, logger: false });

    expect(await reader.openReadOnly('INBOX')).toEqual({ uidValidity: '7', exists: 3 });
    const uids = await reader.searchUids({ domains: ['amazon.com', 'walmart.com'], since: new Date('2026-01-01'), afterUid: 3 });
    expect(uids).toEqual([9, 12]); // "4:*" can return UID 3; it is dropped
    const headers = await reader.fetchHeaders([9]);
    expect(headers[0]).toMatchObject({ uid: 9, fromAddress: 'auto-confirm@amazon.com', subject: 'Your order', messageId: '<m9@amazon.com>' });
    await reader.close();

    const lock = fake.calls.find((c) => c[0] === 'lock');
    expect(lock[2]).toEqual({ readOnly: true });
    const search = fake.calls.find((c) => c[0] === 'search');
    expect(search[1]).toMatchObject({ or: [{ from: 'amazon.com' }, { from: 'walmart.com' }], uid: '4:*' });
    const fetch = fake.calls.find((c) => c[0] === 'fetch');
    expect(fetch[2]).toEqual({ uid: true, envelope: true }); // headers only, no body, no \Seen
    expect(fake.calls).toContain('logout');
  });
});

describe('To-Do items from email', () => {
  it('asks to check matches and to reconnect a failing mailbox', () => {
    const { buildTodos } = require('../services/todos.js');
    const items = buildTodos({ emailReview: { count: 2, newestId: 'o9' }, emailAccounts: [{ id: 'a1', email_address: 'me@gmail.com', status: 'error', last_error: 'Needs an app password.' }, { id: 'a2', email_address: 'ok@gmail.com', status: 'active' }] }, '2026-03-01');
    expect(items.map((i) => [i.key, i.title])).toEqual([
      ['email-reconnect:a1', 'Reconnect me@gmail.com'],
      ['email-review:o9', '2 orders from email to check'],
    ]);
    expect(items[1].link).toEqual({ kind: 'page', to: '/settings', state: { tab: 'email' } });
  });
});
