import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const express = require('express');
const { requestLog } = require('../middleware/requestLog');

const lines = [];
let server;
let base;
let port;
beforeAll(async () => {
  const app = express();
  app.use(requestLog({ log: (line) => lines.push(line) }));
  app.use(express.json());
  app.use('/api/blocked', (req, res) => res.status(401).json({}));
  const router = express.Router();
  router.get('/', async (req, res) => { await new Promise((r) => setTimeout(r, 5)); res.json([]); });
  router.get('/feed.ics', (req, res) => res.send('ok'));
  router.put('/:id', async (req, res) => { await null; res.json({}); });
  router.get('/boom', (req, res, next) => next(new Error('secret detail')));
  router.get('/:id/boom', (req, res, next) => next(new Error('secret detail')));
  router.get('/slow', () => {});
  app.use('/api/inventory', router);
  app.get('/health', (req, res) => res.json({}));
  app.use((err, req, res, next) => { if (res.headersSent) return next(err); res.status(500).json({}); }); // eslint-disable-line no-unused-vars
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});
beforeEach(() => { lines.length = 0; });
afterAll(() => { server.closeAllConnections(); server.close(); });

const call = async (path, options) => { await (await fetch(base + path, options)).text(); await new Promise((r) => setTimeout(r, 10)); };
const said = () => lines.map((l) => l.replace(/ \d+ms$/, ' Nms'));

describe('request log', () => {
  it('writes the method, route pattern, status and time', async () => {
    await call('/api/inventory');
    expect(said()).toEqual(['[request] GET /api/inventory 200 Nms']);
  });

  it('keeps ids, tokens, search text, bodies and headers out', async () => {
    await call('/api/inventory/11111111-secret-id?q=private+search', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.9', 'User-Agent': 'private-agent', Authorization: 'Bearer private-key' }, body: '{"cost":"1234.56"}' });
    await call('/api/inventory/feed.ics?token=private-token');
    expect(said()).toEqual(['[request] PUT /api/inventory/:id 200 Nms', '[request] GET /api/inventory/feed.ics 200 Nms']);
    expect(lines.join('\n')).not.toMatch(/secret|private|203\.0\.113|1234\.56|127\.0\.0\.1/);
  });

  it('shortens requests no route answered, and never repeats an unknown address', async () => {
    await call('/api/blocked/secret-id?x=1');
    await call('/api/unknown/secret-id');
    await call('/secret-token-typed-wrong');
    expect(said()).toEqual(['[request] GET /api/* 401 Nms', '[request] GET /api/* 404 Nms', '[request] GET /* 404 Nms']);
  });

  it('logs a failure as its status without the error, once', async () => {
    await call('/api/inventory/boom');
    expect(said()).toEqual(['[request] GET /api/inventory/boom 500 Nms']);
  });

  it('keeps a failed record\'s id out too', async () => {
    await call('/api/inventory/secret-id/boom?q=private');
    expect(said()).toEqual(['[request] GET /api/inventory/:id/boom 500 Nms']);
  });

  it('marks a request the caller gave up on', async () => {
    await new Promise((resolve) => {
      const req = http.get({ port, path: '/api/inventory/slow', host: '127.0.0.1' });
      req.on('error', () => setTimeout(resolve, 50));
      setTimeout(() => req.destroy(), 50);
    });
    expect(said()).toEqual(['[request] GET /api/inventory/slow aborted Nms']);
  });

  it('skips health checks', async () => {
    await call('/health');
    expect(lines).toEqual([]);
  });
});
