// One line per request in the server log: method, route, status, time taken.
//
// The route is the pattern the code declares ("/api/inventory/:id"), never the
// address that was asked for, so record ids, search text, calendar and invite
// tokens stay out of the log. Nothing about the person is written either: no
// IP address, browser, user id, headers or body.

// A request no route answered (signed out, blocked, limited, unknown) has no
// pattern, so only the first part of its address is kept, and only when it is
// one of ours: anything else could be a mistyped token.
const AREAS = new Set(['api', 'auth', 'internal', 'mcp']);

// Where the route's router is mounted ("/api/inventory"): fixed text, never part
// of what the caller chose. Express clears baseUrl once a route passes an error
// on, so then it is what the address has in front of the route's own pattern.
const parts = (path) => path.split('/').filter(Boolean);
function mountOf(req, pattern) {
  if (req.baseUrl) return req.baseUrl;
  if (/[*?+(]/.test(pattern)) return '';
  const asked = parts(String(req.originalUrl || '').split(/[?#]/)[0]);
  const mount = asked.slice(0, Math.max(0, asked.length - parts(pattern).length));
  return mount.map((p) => `/${p}`).join('');
}

function routeOf(req) {
  const pattern = req.route?.path;
  if (typeof pattern === 'string') return `${mountOf(req, pattern)}${pattern === '/' ? '' : pattern}` || '/';
  const area = String(req.originalUrl || '').split(/[/?#]/)[1] || '';
  return AREAS.has(area) ? `/${area}/*` : '/*';
}

function requestLog({ log = console.log, now = () => performance.now() } = {}) {
  return (req, res, next) => {
    if (req.path === '/health') return next();
    const started = now();
    let written = false;
    const write = (status) => {
      if (written) return;
      written = true;
      log(`[request] ${req.method} ${routeOf(req)} ${status} ${Math.round(now() - started)}ms`);
    };
    res.on('finish', () => write(res.statusCode));
    // The caller went away before an answer was sent.
    res.on('close', () => write('aborted'));
    next();
  };
}

module.exports = { requestLog, routeOf };
