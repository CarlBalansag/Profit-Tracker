require('dotenv').config();
const prisma = require('../prisma');
const { firebaseConfig, getFirebaseAuth } = require('../services/firebase');

async function approve({ userId, firebaseUid, prisma, auth, projectId }) {
  if (!userId || !firebaseUid) throw new Error('Exact existing user ID and Firebase UID required');
  const target = await auth.getUser(firebaseUid);
  if (target.disabled || !target.emailVerified || !target.email || target.email.endsWith('.invalid')) throw new Error('Target identity must be enabled with verified real email');
  return prisma.$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    const credential = await tx.localCredential.findUnique({ where: { user_id: userId } });
    if (!user || user.login_disabled || !credential || credential.disabled || credential.must_change_password) throw new Error('Existing account must first have a private password');
    if (await tx.firebaseIdentity.findFirst({ where: { OR: [{ user_id: userId }, { project_id: projectId, firebase_uid: firebaseUid }] } })) throw new Error('Identity already linked; reconciliation is a separate task');
    await tx.migrationApproval.updateMany({ where: { user_id: userId, consumed: false }, data: { consumed: true } });
    return tx.migrationApproval.create({ data: { user_id: userId, project_id: projectId, firebase_uid: firebaseUid, expires_at: new Date(Date.now() + 3600000) } });
  });
}
if (require.main === module) {
  const [userId, firebaseUid] = process.argv.slice(2);
  const config = firebaseConfig();
  if (!config.enabled) throw new Error('Configure Firebase first');
  approve({ userId, firebaseUid, prisma, auth: getFirebaseAuth(config), projectId: config.projectId })
    .then(row => console.log('Migration approval created:', row.id, 'expires:', row.expires_at.toISOString()))
    .catch(() => { console.error('Approval failed. Check exact IDs, verified identity and existing private-password access.'); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
module.exports = { approve };
