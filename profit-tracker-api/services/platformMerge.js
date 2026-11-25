// Merges one cashout group into another: everything recorded on the first
// moves to the second, then the empty first one is removed. All of it happens
// in one transaction and is one Activity entry, so one undo brings the group
// back with everything that was on it.
const prisma = require('../prisma');
const { Prisma } = require('@prisma/client');
const activityLog = require('./activityLog');

const { LINKS, TABLE } = activityLog;
// Moving and logging a group with hundreds of sales can outlast Prisma's
// default 5 seconds on a remote database.
const TRANSACTION = { timeout: 120000, maxWait: 10000 };
const requestError = (status, message) => Object.assign(new Error(message), { status });
const isCashout = (platform) => String(platform.type || '').toLowerCase() === 'cashout';
const blank = (value) => value === null || value === undefined || value === '';

// Counts by model, as the merge window lists them.
const COUNT_KEYS = {
  sales: 'sales', inventory: 'purchases', account: 'store_accounts', cashoutConnection: 'connections',
  importBatch: 'imports', taxForm1099K: 'tax_forms',
};
const ownedBy = (model, userId) => (model === 'sales' ? { inventory: { user_id: userId } } : { user_id: userId });

async function ownedGroup(client, userId, id, missing) {
  const group = await client.platform.findFirst({ where: { id, user_id: userId } });
  if (!group) throw requestError(404, missing);
  if (!isCashout(group)) throw requestError(400, 'Only cashout groups can be merged.');
  return group;
}

// What a merge would move, for the window to show before anything happens.
async function mergePreview(userId, id) {
  await ownedGroup(prisma, userId, id, 'Cashout group not found');
  const counts = {};
  for (const [model, field] of LINKS.platform) {
    counts[COUNT_KEYS[model]] = await prisma[model].count({ where: { [field]: id, ...ownedBy(model, userId) } });
  }
  return { counts };
}

// What the kept group takes from the removed one: details it has no value for,
// and both notes when they differ. Its own name, fee and tax setting stay.
function filledDetails(from, into) {
  const data = {};
  for (const key of ['address', 'default_return_days', 'workflow_preset']) {
    if (blank(into[key]) && !blank(from[key])) data[key] = from[key];
  }
  if (!blank(from.notes)) {
    if (blank(into.notes)) data.notes = from.notes;
    else if (!into.notes.includes(from.notes)) data.notes = `${into.notes}\n${from.notes}`;
  }
  return data;
}

async function mergePlatforms(userId, fromId, intoId, { source } = {}) {
  if (fromId === intoId) throw requestError(400, 'Pick two different cashout groups.');
  return prisma.$transaction(async (tx) => {
    // Nothing new can be recorded on either group until this is done. Same
    // order every time, so two merges can't wait on each other.
    await tx.$queryRaw`SELECT id FROM "Platform" WHERE id IN (${Prisma.join([fromId, intoId])}) ORDER BY id FOR UPDATE`;
    const from = await ownedGroup(tx, userId, fromId, 'This cashout group was already merged or removed.');
    const into = await ownedGroup(tx, userId, intoId, 'The group to keep no longer exists.');
    // And nothing on the group can be moved elsewhere meanwhile. The names
    // come from fixed lists, never from the request.
    for (const [model, field] of LINKS.platform) {
      await tx.$queryRaw`SELECT id FROM ${Prisma.raw(`"${TABLE[model]}"`)} WHERE ${Prisma.raw(`"${field}"`)} = ${fromId} ORDER BY id FOR UPDATE`;
    }

    const moved = {};
    const { result: platform, activity } = await activityLog.trackChange(tx, userId, {
      action: 'merge',
      recordType: 'platform',
      recordId: fromId,
      productName: from.name,
      source,
      refs: async () => ({ platform: [fromId, intoId] }),
      linkRefs: (t) => activityLog.linkedRefs(t, userId, 'platform', fromId),
      extra: { merged_into: into.name, merged_into_id: into.id },
    }, async () => {
      for (const [model, field] of LINKS.platform) {
        const { count } = await tx[model].updateMany({ where: { [field]: fromId, ...ownedBy(model, userId) }, data: { [field]: intoId } });
        moved[COUNT_KEYS[model]] = count;
      }
      const details = filledDetails(from, into);
      const kept = Object.keys(details).length ? await tx.platform.update({ where: { id: intoId }, data: details }) : into;
      await tx.platform.delete({ where: { id: fromId } });
      return kept;
    });
    return { platform, moved, activity };
  }, TRANSACTION);
}

module.exports = { mergePreview, mergePlatforms };
