// Request limits are counted per signed-in user or API key, never per shared
// network address (middleware/rateLimiters.js).
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import express from 'express';

const require = createRequire(import.meta.url);
const { makeLimiter, userKey, apiKeyKey, positiveInt } = require('../middleware/rateLimiters');

async function serve(limiter, identify) {
  const app = express();
  app.use((req, res, next) => { identify(req); next(); });
  app.use(limiter);
  app.get('/', (req, res) => res.json({ ok: true }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}/`;
  const hit = (headers = {}) => fetch(url, { headers }).then(async (r) => ({ status: r.status, body: await r.json(), headers: r.headers }));
  return { hit, close: () => new Promise((resolve) => server.close(resolve)) };
}

describe('request limits', () => {
  it('counts each signed-in user separately, even from the same address', async () => {
    const limiter = makeLimiter({ limit: 2, key: userKey, message: 'Slow down.' });
    const { hit, close } = await serve(limiter, (req) => { const id = req.get('x-test-user'); if (id) req.user = { id }; });
    try {
      expect((await hit({ 'x-test-user': 'a' })).status).toBe(200);
      expect((await hit({ 'x-test-user': 'a' })).status).toBe(200);
      const blocked = await hit({ 'x-test-user': 'a' });
      expect(blocked.status).toBe(429);
      expect(blocked.body).toEqual({ error: 'Slow down.' });
      expect(blocked.headers.get('retry-after')).toBeTruthy();
      // Another user on the same address is not affected.
      expect((await hit({ 'x-test-user': 'b' })).status).toBe(200);
    } finally { await close(); }
  });

  it('counts each API key separately', async () => {
    const limiter = makeLimiter({ limit: 1, key: apiKeyKey, message: 'Slow down.' });
    const { hit, close } = await serve(limiter, (req) => { req.apiKeyId = req.get('x-test-key'); });
    try {
      expect((await hit({ 'x-test-key': 'k1' })).status).toBe(200);
      expect((await hit({ 'x-test-key': 'k1' })).status).toBe(429);
      expect((await hit({ 'x-test-key': 'k2' })).status).toBe(200);
    } finally { await close(); }
  });

  it('falls back to the address for a request with no user', async () => {
    const limiter = makeLimiter({ limit: 1, key: userKey, message: 'Slow down.' });
    const { hit, close } = await serve(limiter, () => {});
    try {
      expect((await hit()).status).toBe(200);
      expect((await hit()).status).toBe(429);
    } finally { await close(); }
  });

  it('starts counting again after the window', async () => {
    const limiter = makeLimiter({ limit: 1, windowMs: 150, key: userKey, message: 'Slow down.' });
    const { hit, close } = await serve(limiter, (req) => { req.user = { id: 'a' }; });
    try {
      expect((await hit()).status).toBe(200);
      expect((await hit()).status).toBe(429);
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect((await hit()).status).toBe(200);
    } finally { await close(); }
  });

  it('ignores a bad limit setting', () => {
    expect(positiveInt('2000', 1500)).toBe(2000);
    for (const bad of [undefined, '', '0', '-5', 'abc', '1.5']) expect(positiveInt(bad, 1500)).toBe(1500);
  });
});
