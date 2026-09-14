// Owner-only CLI. There is intentionally no public registration/reset endpoint.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { z } = require('zod');
const { hashPassword } = require('../services/passwords');

async function provisionLogin({ prisma, args, fileSystem = fs, outputLog = console.log }) {
  const value = name => {
    const index = args.indexOf(name);
    return index < 0 || args[index + 1]?.startsWith('--') ? undefined : args[index + 1];
  };
  const user_id = z.string().uuid().parse(value('--user-id'));
  const email = z.string().trim().toLowerCase().email().max(254).parse(value('--email'));
  const user = await prisma.user.findUnique({ where: { id: user_id }, select: { id: true, username: true } });
  if (!user) throw new Error('Existing user ID not found. No account created.');
  const existing = await prisma.localCredential.findUnique({ where: { user_id } });
  const reset = args.includes('--reset-existing');
  if (existing && !reset) throw new Error('Credentials already exist. Reset requires --reset-existing.');
  if (!args.includes('--apply')) {
    outputLog(JSON.stringify({ dryRun: true, user: user.username, user_id, loginEmail: email,
      operation: existing ? 'reset-existing-credentials' : 'attach-credentials-to-existing-user', businessRecordsMoved: 0 }));
    return;
  }
  const output = value('--credentials-file');
  const repo = path.resolve(__dirname, '../..');
  if (!output || !path.isAbsolute(output) || path.resolve(output).toLowerCase().startsWith(repo.toLowerCase() + path.sep))
    throw new Error('Provide --credentials-file as an absolute path outside this repository.');
  const temporaryPassword = randomBytes(18).toString('base64url');
  const password_hash = await hashPassword(temporaryPassword);
  const temporary_expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const fd = fileSystem.openSync(output, 'wx', 0o600);
  let committed = false;
  try {
    await prisma.$transaction(async tx => {
      if (!await tx.user.findUnique({ where: { id: user_id }, select: { id: true } }))
        throw new Error('User no longer exists.');
      const data = { email, password_hash, must_change_password: true, temporary_expires_at, disabled: false };
      if (existing) {
        const result = await tx.localCredential.updateMany({ where: { user_id, version: existing.version },
          data: { ...data, version: { increment: 1 } } });
        if (result.count !== 1) throw new Error('Credentials changed concurrently. Retry after checking the account.');
      } else await tx.localCredential.create({ data: { user_id, ...data } });
      fileSystem.writeFileSync(fd, JSON.stringify({ username: user.username, user_id, email, temporaryPassword,
        expiresAt: temporary_expires_at.toISOString(), mustChangePassword: true }, null, 2));
      fileSystem.fsyncSync(fd);
    }, { isolationLevel: 'Serializable' });
    committed = true;
    outputLog('Credentials saved to the requested private file. Existing user ID and business data preserved.');
  } finally {
    fileSystem.closeSync(fd);
    if (!committed) fileSystem.unlinkSync(output);
  }
}

module.exports = { provisionLogin };
if (require.main === module) {
require('dotenv').config();
const prisma = require('../prisma');
provisionLogin({ prisma, args: process.argv.slice(2) }).catch(error => {
  // Prisma errors may contain connection details; never print full errors/arguments.
  console.error(error instanceof z.ZodError ? 'Invalid provisioning arguments.'
    : error.code ? `Provisioning failed (${error.code}). No success reported.` : error.message);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
}
