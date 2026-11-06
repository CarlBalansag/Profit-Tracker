// Settings > Data reset. Deletes one user's records in a single database
// transaction, so a failure part way through leaves everything in place.
//
// Never deleted, by either scope: the User row, login records
// (LocalCredential, FirebaseIdentity and its sessions), ApiKey rows, and the
// preferences stored on User. EbayPriceCache is shared by every user, so it is
// not touched either.
const cloudinary = require('cloudinary').v2;
const defaultPrisma = require('../prisma');
const { dealsCache } = require('./cashouts/service');
const { publishCalendarFeed } = require('./calendarFeed');

const RESET_SCOPES = ['transactions', 'everything'];
const RESET_CONFIRMATION = 'RESET';

// A big account on a remote database can take far longer than Prisma's
// 5-second default for an interactive transaction.
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 120_000 };
const RECEIPT_FOLDER = 'profittracker/receipts/';
const RECEIPT_DELETE_CONCURRENCY = 5;

// receipts.js names every upload `${itemType}_${itemId}_${uuid}`.
const RECEIPT_NAME = /^(inventory|expense)_([^_/]+)(?:_[^/]*)?$/;

// receipt_url is client-supplied on expenses and Attachment.url is any link, so
// a URL alone proves nothing about who owns the file. Only a Cloudinary receipt
// whose own name points at a row being deleted for this user is returned --
// otherwise a pasted URL could destroy another user's receipt.
function receiptFileFromUrl(url, ownedRows, cloudName = process.env.CLOUDINARY_CLOUD_NAME) {
  if (typeof url !== 'string' || !cloudName) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com') return null;

  const match = parsed.pathname.match(/^\/([^/]+)\/(image|raw|video)\/upload\/(?:v\d+\/)?(.+)$/);
  if (!match || match[1] !== cloudName) return null;
  const [, , resourceType, storedPath] = match;
  if (!storedPath.startsWith(RECEIPT_FOLDER)) return null;

  const fileName = storedPath.slice(RECEIPT_FOLDER.length);
  // Only raw files keep their extension in the public ID.
  const name = resourceType === 'raw' ? fileName : fileName.replace(/\.[^./]+$/, '');
  const owner = name.match(RECEIPT_NAME);
  if (!owner || !ownedRows.has(`${owner[1]}:${owner[2]}`)) return null;

  return { publicId: `${RECEIPT_FOLDER}${name}`, resourceType };
}

function collectReceiptFiles({ inventories, expenses, attachments }) {
  const ownedRows = new Set([
    ...inventories.map((row) => `inventory:${row.id}`),
    ...expenses.map((row) => `expense:${row.id}`),
  ]);
  const urls = [...inventories, ...expenses].map((row) => row.receipt_url)
    .concat(attachments.map((row) => row.url));

  const files = new Map();
  for (const url of urls) {
    const file = receiptFileFromUrl(url, ownedRows);
    if (file) files.set(file.publicId, file);
  }
  return [...files.values()];
}

// Most of these foreign keys are ON DELETE SET NULL or CASCADE, so another
// user's row linked to this user's records would be silently changed by the
// deletes. Routes check ownership, so this means bad older data: stop and roll
// back rather than edit someone else's records.
async function assertNoLinksFromOtherUsers(tx, userId, everything) {
  const mine = { user_id: userId };
  const others = { user_id: { not: userId } };
  const checks = [
    tx.refund.count({ where: { ...others, OR: [{ inventory: mine }, { sale: { inventory: mine } }] } }),
  ];
  if (everything) {
    checks.push(
      tx.inventory.count({ where: { ...others, OR: [{ vendor: mine }, { payment_method: mine }] } }),
      tx.sales.count({ where: { inventory: others, OR: [{ platform: mine }, { buyer: mine }, { sale_shipping_payment_method: mine }] } }),
      tx.expense.count({ where: { ...others, OR: [{ payment_method: mine }, { recurring_expense: mine }] } }),
      tx.recurringExpense.count({ where: { ...others, payment_method: mine } }),
      tx.account.count({ where: { ...others, platform: mine } }),
      tx.cashoutConnection.count({ where: { ...others, platform: mine } }),
      tx.cashoutDealSnapshot.count({ where: { ...others, connection: mine } }),
      tx.cashoutItemMatch.count({ where: { ...others, connection: mine } }),
    );
  }
  const linked = (await Promise.all(checks)).reduce((sum, count) => sum + count, 0);
  if (linked) throw new Error(`Data reset stopped: ${linked} other-user row(s) link to user ${userId}`);
}

async function deleteTransactions(tx, userId) {
  const cashoutItemMatches = await tx.cashoutItemMatch.deleteMany({ where: { user_id: userId } });
  const transactionNotes = await tx.transactionNote.deleteMany({ where: { user_id: userId } });
  const attachments = await tx.attachment.deleteMany({ where: { user_id: userId } });
  const changeLogs = await tx.changeLog.deleteMany({
    where: { user_id: userId, table_name: { in: ['Inventory', 'Sales'] } },
  });
  const refunds = await tx.refund.deleteMany({ where: { user_id: userId } });
  const sales = await tx.sales.deleteMany({ where: { inventory: { user_id: userId } } });
  const purchases = await tx.inventory.deleteMany({ where: { user_id: userId } });

  return {
    purchases: purchases.count,
    sales: sales.count,
    refunds: refunds.count,
    transactionNotes: transactionNotes.count,
    attachments: attachments.count,
    changeLogs: changeLogs.count,
    cashoutItemMatches: cashoutItemMatches.count,
  };
}

// Runs after deleteTransactions, so nothing still points at these rows through
// the foreign keys that have no cascade. Children go before their parents.
async function deleteSetupData(tx, userId) {
  const where = { user_id: userId };
  const remainingChangeLogs = await tx.changeLog.deleteMany({ where });
  const aiWriteLogs = await tx.mcpWriteLog.deleteMany({ where });
  const cashoutDealSnapshots = await tx.cashoutDealSnapshot.deleteMany({ where });
  const cashoutConnections = await tx.cashoutConnection.deleteMany({ where });
  const invoices = await tx.invoice.deleteMany({ where });
  const buyers = await tx.buyer.deleteMany({ where });
  const expenses = await tx.expense.deleteMany({ where });
  const recurringExpenses = await tx.recurringExpense.deleteMany({ where });
  const goals = await tx.goal.deleteMany({ where });
  const productNotes = await tx.productNote.deleteMany({ where });
  const calendarEvents = await tx.calendarEvent.deleteMany({ where });
  const accounts = await tx.account.deleteMany({ where });
  const platforms = await tx.platform.deleteMany({ where });
  const paymentMethods = await tx.paymentMethod.deleteMany({ where });

  return {
    remainingChangeLogs: remainingChangeLogs.count,
    aiWriteLogs: aiWriteLogs.count,
    cashoutDealSnapshots: cashoutDealSnapshots.count,
    cashoutConnections: cashoutConnections.count,
    invoices: invoices.count,
    buyers: buyers.count,
    expenses: expenses.count,
    recurringExpenses: recurringExpenses.count,
    goals: goals.count,
    productNotes: productNotes.count,
    calendarEvents: calendarEvents.count,
    accounts: accounts.count,
    platforms: platforms.count,
    paymentMethods: paymentMethods.count,
  };
}

// Returns what was deleted and the Cloudinary files that are now unreferenced.
// The files can't take part in the transaction, so the caller removes them only
// after this has committed: a rollback must not cost anyone a receipt.
async function resetUserData(userId, scope, client = defaultPrisma) {
  if (!userId) throw new Error('resetUserData needs a user id');
  if (!RESET_SCOPES.includes(scope)) throw new Error(`Unknown reset scope: ${scope}`);

  return client.$transaction(async (tx) => {
    // FOR UPDATE conflicts with the key-share lock every insert takes on its
    // User foreign key, so this makes a second reset wait, and stops a purchase
    // saved mid-reset from slipping in behind the deletes.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;

    const everything = scope === 'everything';
    const [inventories, expenses, attachments, connections] = await Promise.all([
      tx.inventory.findMany({ where: { user_id: userId }, select: { id: true, receipt_url: true } }),
      everything
        ? tx.expense.findMany({ where: { user_id: userId }, select: { id: true, receipt_url: true } })
        : [],
      tx.attachment.findMany({ where: { user_id: userId }, select: { url: true } }),
      everything
        ? tx.cashoutConnection.findMany({ where: { user_id: userId }, select: { id: true } })
        : [],
    ]);

    await assertNoLinksFromOtherUsers(tx, userId, everything);
    const deleted = await deleteTransactions(tx, userId);
    if (everything) {
      const { remainingChangeLogs, ...setup } = await deleteSetupData(tx, userId);
      Object.assign(deleted, setup);
      deleted.changeLogs += remainingChangeLogs;
    }

    return {
      deleted,
      receiptFiles: collectReceiptFiles({ inventories, expenses, attachments }),
      connectionIds: connections.map((row) => row.id),
    };
  }, TRANSACTION_OPTIONS);
}

// Best effort: the rows are already gone, so a file that won't delete is logged
// rather than reported as a failed reset.
async function removeReceiptFiles(files) {
  const queue = [...files];
  let failed = 0;
  const worker = async () => {
    while (queue.length) {
      const { publicId, resourceType } = queue.shift();
      try {
        await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
      } catch (error) {
        failed += 1;
        console.error('[data-reset] receipt file not removed:', publicId, error.message);
      }
    }
  };
  await Promise.all(Array.from({ length: RECEIPT_DELETE_CONCURRENCY }, worker));
  return { failed };
}

// What lives outside the database and has to catch up once the reset commits.
async function finishReset(userId, { connectionIds }) {
  connectionIds.forEach((id) => dealsCache.delete(id));
  // The published .ics lists purchases and sales, and calendar apps keep
  // reading it. publishCalendarFeed logs its own failures and never throws.
  await publishCalendarFeed(userId);
}

module.exports = {
  RESET_SCOPES,
  RESET_CONFIRMATION,
  resetUserData,
  receiptFileFromUrl,
  removeReceiptFiles,
  finishReset,
};
