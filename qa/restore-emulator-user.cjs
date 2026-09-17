// One-off helper: the Firebase Auth emulator keeps its users in memory and
// forgets them on restart, while the matching FirebaseIdentity row persists in
// the real (branched) database. This recreates the emulator-side user with the
// same UID so the existing Neon identity mapping keeps working after a restart.
const { createRequire } = require('node:module');
const requireApi = createRequire(require('path').join(__dirname, '../selvora-api/package.json'));
requireApi('dotenv').config({ path: require('path').join(__dirname, '../selvora-api/.env') });
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const { initializeApp } = requireApi('firebase-admin/app');
const { getAuth } = requireApi('firebase-admin/auth');
const prisma = requireApi('./prisma');

async function run() {
  const identity = await prisma.firebaseIdentity.findFirst({ where: { email: 'shipping-browser-qa@example.test' } });
  if (!identity) throw new Error('No FirebaseIdentity row found for that email in the Neon branch.');
  const auth = getAuth(initializeApp({ projectId: 'demo-profittracker' }, 'restore-emulator-only'));
  await auth.createUser({ uid: identity.firebase_uid, email: identity.email, password: 'isolated shipping browser qa password', emailVerified: true });
  console.log('Recreated emulator user', identity.email, 'with uid', identity.firebase_uid);
}
run().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
