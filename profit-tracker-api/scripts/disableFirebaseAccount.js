require('dotenv').config();
const prisma = require('../prisma');
const { firebaseConfig, getFirebaseAuth } = require('../services/firebase');

async function disable({ prisma, auth, userId }) {
  if (!userId) throw new Error('Exact user ID required');
  const identity = await prisma.$transaction(async tx => {
    await tx.user.update({ where: { id: userId }, data: { login_disabled: true } });
    const identity = await tx.firebaseIdentity.findUnique({ where: { user_id: userId } });
    if (identity) await tx.firebaseSession.updateMany({ where: { identity_id: identity.id }, data: { revoked: true } });
    return identity;
  });
  // Durable local disable survives provider failure. Repeat this command to retry remote revocation.
  if (identity) {
    if (!auth) throw new Error('Local access disabled; configure Firebase and retry provider revocation');
    await auth.revokeRefreshTokens(identity.firebase_uid);
  }
}
if (require.main === module) {
  const [userId] = process.argv.slice(2);
  const config = firebaseConfig();
  disable({ prisma, auth: getFirebaseAuth(config), userId })
    .then(() => console.log('Account access disabled.'))
    .catch(() => { console.error('Disable/revocation not fully confirmed. Local disable may have committed; retry with the exact user ID.'); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
module.exports = { disable };
