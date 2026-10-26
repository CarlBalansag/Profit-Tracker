const { initializeApp, getApps, cert, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

function firebaseConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  if (production && env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Firebase Auth emulator forbidden in production');
  const enabled = env.FIREBASE_AUTH_ENABLED === 'true';
  if (enabled && !env.FIREBASE_PROJECT_ID) throw new Error('FIREBASE_PROJECT_ID required');
  const frontend = env.FRONTEND_URL || 'http://localhost:5173';
  if (enabled && production && new URL(frontend).protocol !== 'https:') throw new Error('Firebase production frontend must use HTTPS');
  return { enabled, production, projectId: env.FIREBASE_PROJECT_ID,
    signupEnabled: env.FIREBASE_SIGNUP_ENABLED === 'true', frontend };
}
function getFirebaseAuth(config) {
  if (!config.enabled) return null;
  let app = getApps().find(app => app.name === 'profittracker-auth');
  if (!app) {
    let credential;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      let account;
      try { account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON); } catch { throw new Error('Invalid Firebase server credential JSON'); }
      if (account.project_id !== config.projectId) throw new Error('Firebase server credential must belong to the configured project');
      try { credential = cert(account); } catch { throw new Error('Invalid Firebase server credential'); }
    } else credential = applicationDefault();
    app = initializeApp({ projectId: config.projectId, credential }, 'profittracker-auth');
  }
  return getAuth(app);
}
module.exports = { firebaseConfig, getFirebaseAuth };
