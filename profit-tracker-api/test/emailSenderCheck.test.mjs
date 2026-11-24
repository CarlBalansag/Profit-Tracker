// Sender check: an email counts as a store's only when the user's mail
// provider confirmed it came from the store's domain (services/email/senderCheck.js).
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { checkSender, parseHeader, orgDomain } = require('../services/email/senderCheck');

const GMAIL_PASS = 'Authentication-Results: mx.google.com;\r\n       dkim=pass header.i=@amazon.com header.s=x header.b=abc;\r\n       spf=pass (google.com: domain of a@bounces.amazon.com designates 1.2.3.4 as permitted sender) smtp.mailfrom=a@bounces.amazon.com;\r\n       dmarc=pass (p=QUARANTINE sp=QUARANTINE dis=NONE) header.from=amazon.com';
const check = (headers, over = {}) => checkSender({ fromAddress: 'auto-confirm@amazon.com', preset: 'gmail', headers, ...over });

describe('email sender check', () => {
  it('reads a folded header with comments', () => {
    expect(parseHeader(GMAIL_PASS)).toEqual({
      authserv: 'mx.google.com',
      results: [
        { method: 'dkim', result: 'pass', props: { 'header.i': '@amazon.com', 'header.s': 'x', 'header.b': 'abc' } },
        { method: 'spf', result: 'pass', props: { 'smtp.mailfrom': 'a@bounces.amazon.com' } },
        { method: 'dmarc', result: 'pass', props: { 'header.from': 'amazon.com' } },
      ],
    });
    expect(parseHeader('dkim=pass')).toBeNull();
    expect(parseHeader('')).toBeNull();
  });

  it('compares registered domains', () => {
    expect(orgDomain('orders@email.apple.com')).toBe('apple.com');
    expect(orgDomain('shop.example.co.uk')).toBe('example.co.uk');
    expect(orgDomain('localhost')).toBeNull();
  });

  it('accepts an email Gmail confirmed, from the domain or a subdomain', () => {
    expect(check([GMAIL_PASS])).toEqual({ ok: true, reason: 'dmarc' });
    expect(check(['mx.google.com; dmarc=pass header.from=apple.com'], { fromAddress: 'no_reply@email.apple.com' }).ok).toBe(true);
  });

  it('refuses a failed check, a missing one, and a verdict about another domain', () => {
    expect(check(['mx.google.com; spf=fail smtp.mailfrom=x@evil.example; dmarc=fail (p=QUARANTINE) header.from=amazon.com'])).toEqual({ ok: false, reason: 'dmarc_fail' });
    expect(check([])).toEqual({ ok: false, reason: 'no_result' });
    expect(check(['mx.google.com; dmarc=pass header.from=evil.example'])).toEqual({ ok: false, reason: 'dmarc_other_domain' });
    // A pass for the sender's own domain doesn't cover the From domain.
    expect(check(['mx.google.com; dkim=pass header.i=@evil.example; spf=pass smtp.mailfrom=x@evil.example; dmarc=none header.from=amazon.com'])).toEqual({ ok: false, reason: 'not_verified' });
  });

  it("ignores a result the sender wrote themselves, even above Gmail's own", () => {
    const forged = 'evil.example; dmarc=pass header.from=amazon.com';
    expect(check([forged])).toEqual({ ok: false, reason: 'no_result' });
    expect(check([forged, 'mx.google.com; dmarc=fail header.from=amazon.com']).ok).toBe(false);
    expect(check(['mx.google.com; dmarc=fail header.from=amazon.com', forged]).ok).toBe(false);
    // A look-alike name is not Gmail.
    expect(check(['mx.google.com.evil.example; dmarc=pass header.from=amazon.com']).ok).toBe(false);
  });

  it('falls back to a signature or sending server of the From domain when there is no DMARC verdict', () => {
    expect(check(['mx.google.com; dkim=pass header.d=mail.shop.example; dmarc=none header.from=shop.example'], { fromAddress: 'orders@shop.example' })).toEqual({ ok: true, reason: 'dkim' });
    expect(check(['mx.google.com; spf=pass smtp.mailfrom=bounce@shop.example'], { fromAddress: 'orders@shop.example' })).toEqual({ ok: true, reason: 'spf' });
    expect(check(['mx.google.com; dkim=fail header.d=shop.example'], { fromAddress: 'orders@shop.example' }).ok).toBe(false);
  });

  it("reads iCloud's one-header-per-check layout and Yahoo's server names", () => {
    const icloud = ['bimi.icloud.com; bimi=skipped reason="x"', 'dmarc.icloud.com; dmarc=pass header.from=amazon.com', 'dkim.icloud.com; dkim=pass header.d=amazon.com', 'spf.icloud.com; spf=pass smtp.mailfrom=a@bounces.amazon.com'];
    expect(check(icloud, { preset: 'icloud' })).toEqual({ ok: true, reason: 'dmarc' });
    expect(check(['atlas-production.v2-mail-prod1-gq1.omega.yahoo.com; dkim=pass header.i=@amazon.com; dmarc=pass(p=QUARANTINE) header.from=amazon.com'], { preset: 'yahoo' }).ok).toBe(true);
    expect(check(['atlas.aol.mail.ne1.yahoo.com; dmarc=fail header.from=amazon.com'], { preset: 'aol' }).ok).toBe(false);
    // A provider name we don't recognise: its topmost header is used.
    expect(check(['mta9.mail.example-provider.net; dmarc=pass header.from=amazon.com'], { preset: 'yahoo' }).ok).toBe(true);
  });

  it('for Other (IMAP) uses the topmost header, and accepts mail when the server writes none', () => {
    expect(check(['mx.myhost.example; dmarc=fail header.from=amazon.com', 'evil.example; dmarc=pass header.from=amazon.com'], { preset: 'other' }).ok).toBe(false);
    expect(check(['mx.myhost.example; dmarc=pass header.from=amazon.com'], { preset: 'other' }).ok).toBe(true);
    expect(check([], { preset: 'other' })).toEqual({ ok: true, reason: 'unchecked' });
  });
});
