import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
let server;
let baseUrl;
const originalCloudName = process.env.CLOUDINARY_CLOUD_NAME;

beforeAll(async () => {
  process.env.CLOUDINARY_CLOUD_NAME = 'qa-cloud';
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => harness.reset());
afterAll(() => server.close());
afterAll(() => { process.env.CLOUDINARY_CLOUD_NAME = originalCloudName; });

const request = async (method, path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

describe('calendar event validation', () => {
  it('rejects impossible dates, reversed ranges, and unsupported colors', async () => {
    const impossible = await request('POST', '/api/calendar-events', { title: 'Impossible', date: '2026-02-31' });
    const reversed = await request('POST', '/api/calendar-events', { title: 'Reversed', date: '2026-09-12', end_date: '2026-09-11' });
    const color = await request('POST', '/api/calendar-events', { title: 'Wrong color', date: '2026-09-12', color: 'orange' });

    expect(impossible.status).toBe(400);
    expect(reversed.status).toBe(400);
    expect(color.status).toBe(400);
    expect(harness.db.calendarEvent).toHaveLength(0);
  });

  it('validates a partial update against the existing date range', async () => {
    const created = await request('POST', '/api/calendar-events', {
      title: 'Shipping window', date: '2026-09-12', end_date: '2026-09-14', color: 'blue',
    });
    const response = await request('PUT', `/api/calendar-events/${created.body.id}`, { end_date: '2026-09-11' });

    expect(created.status).toBe(201);
    expect(response.status).toBe(400);
    expect(harness.db.calendarEvent[0]).toMatchObject({ date: '2026-09-12', end_date: '2026-09-14', color: 'blue' });

    const startAfterEnd = await request('PUT', `/api/calendar-events/${created.body.id}`, { date: '2026-09-15' });
    expect(startAfterEnd.status).toBe(400);
    expect(harness.db.calendarEvent[0]).toMatchObject({ date: '2026-09-12', end_date: '2026-09-14' });
  });

  it('accepts a valid leap-day event', async () => {
    const response = await request('POST', '/api/calendar-events', {
      title: 'Leap day', date: '2028-02-29', color: 'green',
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ date: '2028-02-29', color: 'green' });
  });

  it('returns a stable Cloudinary subscription URL without BACKEND_URL', async () => {
    const response = await request('POST', '/api/calendar-events/token');

    expect(response.status).toBe(200);
    expect(response.body.feedUrl).toContain('/raw/upload/selvora/calendar-feeds/qa-only-token.ics');
    expect(response.body.feedUrl).not.toContain('localhost');
  });
});
