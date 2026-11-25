// Isolated browser/API QA server. Never reads the repository's database environment.
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const apiDir = join(__dirname, '../profit-tracker-api');
const requireApi = require('node:module').createRequire(join(apiDir, 'package.json'));
const EmbeddedPostgres = requireApi('embedded-postgres').default;
let database, directory, child, apiEnvironment, restartRequested = false;
// Stops the throwaway database and removes its folder. Windows can hold a file
// for a moment after Postgres stops, hence the retries.
async function cleanUp() {
  if (database) await database.stop();
  if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => console.warn(`Couldn't remove ${directory}`));
}
function startApi() {
  child = spawn(process.execPath, ['index.js'], { cwd: apiDir, env: apiEnvironment, stdio: 'inherit', windowsHide: true });
  child.on('exit', async () => {
    if (restartRequested) { restartRequested = false; startApi(); console.log('QA API restarted; PostgreSQL kept intact.'); }
    else { await cleanUp(); process.exit(); }
  });
}
async function run() {
  directory = await mkdtemp(join(tmpdir(), 'profittracker-firebase-browser-'));
  database = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port: 55439, user: 'postgres', password: 'isolated-browser-only', persistent: true, onLog: () => {}, onError: console.error });
  await database.initialise(); await database.start(); await database.createDatabase('firebase_browser_qa');
  const url = 'postgresql://postgres:isolated-browser-only@127.0.0.1:55439/firebase_browser_qa';
  const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url, NODE_ENV: 'development', PORT: '3059', FRONTEND_URL: 'http://localhost:5179',
    SESSION_SECRET: 'isolated browser qa session secret never production', FIREBASE_AUTH_ENABLED: 'true', FIREBASE_SIGNUP_ENABLED: 'true',
    FIREBASE_PROJECT_ID: 'demo-profittracker', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIREBASE_SERVICE_ACCOUNT_JSON: '', SENTRY_DSN: '' };
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], { cwd: apiDir, env, stdio: 'pipe' });
  apiEnvironment = env;
  startApi();
  console.log('ISOLATED QA API: http://localhost:3059 (local disposable PostgreSQL only)');
}
process.on('SIGINT', async () => { if (child) child.kill(); else { await cleanUp(); process.exit(); } });
process.stdin.on('data', data => { if (data.toString().trim() === 'restart' && child) { restartRequested = true; child.kill(); } });
run().catch(async error => { console.error(error.message); await cleanUp(); process.exit(1); });
