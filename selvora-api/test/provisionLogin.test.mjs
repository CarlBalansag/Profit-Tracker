import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { provisionLogin } = require('../scripts/provision-login');
const { verifyPassword } = require('../services/passwords');
const id = '4a7506f4-77bf-4896-9764-0b0cc369f802';
let directory, output, credential, prisma, fault, log;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'selvora-provision-fixture-'));
  output = path.join(directory, 'credential.json');
  credential = null; fault = {}; log = vi.fn();
  prisma = {
    user: { findUnique: async () => fault.userMissing ? null : { id, username: 'fixture-owner' } },
    localCredential: { findUnique: async () => structuredClone(credential) },
    $transaction: async callback => {
      let candidate = structuredClone(credential);
      const tx = { user: prisma.user, localCredential: {
        create: async ({ data }) => { candidate = { ...data, version: 1 }; },
        updateMany: async ({ data }) => {
          if (fault.conflict) return { count: 0 };
          candidate = { ...candidate, ...data, version: candidate.version + data.version.increment };
          return { count: 1 };
        },
      } };
      await callback(tx);
      if (fault.commit) throw new Error('Fixture transaction failure');
      credential = candidate;
    },
  };
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
const args = (...extra) => ['--user-id', id, '--email', ' Fixture@Example.test ', ...extra];
const run = (extra = [], fileSystem = fs) => provisionLogin({ prisma, args: args(...extra), fileSystem, outputLog: log });
const apply = () => ['--apply', '--credentials-file', output];
describe('owner-only credential provisioning', () => {
  it('defaults to read-only dry run and rejects missing/unknown users', async () => {
    await run(); expect(credential).toBeNull(); expect(fs.existsSync(output)).toBe(false);
    expect(JSON.parse(log.mock.calls[0][0]).businessRecordsMoved).toBe(0);
    await expect(provisionLogin({ prisma, args: [], outputLog: log })).rejects.toThrow();
    fault.userMissing = true; await expect(run(apply())).rejects.toThrow('Existing user ID not found');
    expect(credential).toBeNull();
  });
  it('stores only a hash and writes a usable expiring temporary password to the private file', async () => {
    await run(apply());
    const file = JSON.parse(fs.readFileSync(output));
    expect(file.user_id).toBe(id); expect(file.email).toBe('fixture@example.test');
    expect(await verifyPassword(file.temporaryPassword, credential.password_hash)).toBe(true);
    expect(credential.must_change_password).toBe(true);
    expect(new Date(file.expiresAt).getTime() - Date.now()).toBeGreaterThan(23 * 3600000);
    expect(JSON.stringify(credential)).not.toContain(file.temporaryPassword);
    expect(JSON.stringify(log.mock.calls)).not.toContain(file.temporaryPassword);
    const before = structuredClone(credential);
    await expect(run(apply())).rejects.toThrow('Reset requires'); expect(credential).toEqual(before);
    await expect(run([...apply(), '--reset-existing'])).rejects.toThrow(); expect(credential).toEqual(before);
  });
  it('requires explicit reset and increments session version without changing the user ID', async () => {
    credential = { user_id: id, version: 7, password_hash: 'old-hash' };
    await run([...apply(), '--reset-existing']);
    expect(credential.version).toBe(8); expect(credential.user_id).toBe(id);
    expect(credential.password_hash).not.toBe('old-hash');
  });
  it('preserves credentials and removes its new file on transaction/file/concurrency failures', async () => {
    fault.commit = true; await expect(run(apply())).rejects.toThrow();
    expect(credential).toBeNull(); expect(fs.existsSync(output)).toBe(false);
    fault = {};
    await expect(run(apply(), { ...fs, writeFileSync: () => { throw new Error('Fixture disk failure'); } })).rejects.toThrow();
    expect(credential).toBeNull(); expect(fs.existsSync(output)).toBe(false);
    credential = { user_id: id, version: 7, password_hash: 'unchanged' }; fault.conflict = true;
    await expect(run([...apply(), '--reset-existing'])).rejects.toThrow('concurrently');
    expect(credential.password_hash).toBe('unchanged'); expect(fs.existsSync(output)).toBe(false);
  });
  it('refuses output inside the repository or missing output paths', async () => {
    await expect(run(['--apply'])).rejects.toThrow('absolute path outside');
    await expect(run(['--apply', '--credentials-file', path.resolve('private-credential.json')])).rejects.toThrow('absolute path outside');
    expect(credential).toBeNull();
  });
});
