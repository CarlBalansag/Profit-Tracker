// Invoices: a bill to one buyer for sales already recorded to that buyer.
//
// An invoice's lines are copies of the sales when they were added (name,
// quantity, unit price, sales tax), so the document stays as issued even if a
// sale is edited later. A sale can be on one invoice at a time; cancelling or
// deleting an invoice frees its sales for another. Nothing here changes a
// sale: marking an invoice paid does not mark its sales paid.
//
// status: DRAFT -> SENT -> PAID, or CANCELLED. "overdue" is not stored: it is
// a SENT invoice whose due date has passed.
const { Prisma } = require('@prisma/client');
const prisma = require('../prisma');
const { Decimal, decimal, add, multiply } = require('./money');

const STATUSES = ['DRAFT', 'SENT', 'PAID', 'CANCELLED'];
const MAX_LINES = 200;

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const notFound = () => fail('Invoice not found', 404);
const isUniqueError = (err) => err?.code === 'P2002' || /Unique constraint/i.test(err?.message || '');

// Calendar dates are kept at noon UTC, like purchases and expenses, so they
// read as the same day in every US time zone.
const toDate = (value) => new Date(`${value}T12:00:00.000Z`);
const dayOf = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);
const money = (value) => Number(decimal(value ?? 0).toFixed(2));

// A sale's values as an invoice line would carry them.
function lineFromSale(sale, position) {
  const unitPrice = decimal(sale.unit_price_decimal ?? sale.unit_price ?? 0).toDecimalPlaces(2);
  const quantity = Number(sale.quantity) || 0;
  return {
    sale_id: sale.id,
    description: String(sale.inventory?.product_name || 'Sale').slice(0, 300),
    quantity,
    unit_price: unitPrice.toFixed(2),
    amount: multiply(unitPrice, quantity).toFixed(2),
    tax: decimal(sale.sale_tax_collected_decimal ?? sale.sale_tax_collected ?? 0).toDecimalPlaces(2).toFixed(2),
    sale_date: sale.sale_date || null,
    position,
  };
}

function totals(lines) {
  const subtotal = add(new Decimal(0), ...lines.map((line) => line.amount));
  const tax = add(new Decimal(0), ...lines.map((line) => line.tax ?? 0));
  return { subtotal, tax, total: subtotal.plus(tax) };
}

function present(invoice, now = new Date()) {
  const lines = [...(invoice.lines || [])].sort((a, b) => a.position - b.position);
  const { subtotal, tax, total } = totals(lines);
  const due = dayOf(invoice.due_date);
  return {
    id: invoice.id,
    number: invoice.number,
    buyer_id: invoice.buyer_id,
    buyer_name: invoice.buyer?.name || null,
    issue_date: dayOf(invoice.issue_date),
    due_date: due,
    status: invoice.status,
    overdue: invoice.status === 'SENT' && due !== null && due < dayOf(now),
    notes: invoice.notes || null,
    subtotal: money(subtotal),
    tax: money(tax),
    total: money(total),
    lines: lines.map((line) => ({
      id: line.id,
      sale_id: line.sale_id,
      description: line.description,
      quantity: line.quantity,
      unit_price: money(line.unit_price),
      amount: money(line.amount),
      tax: money(line.tax),
      sale_date: dayOf(line.sale_date),
    })),
    created_at: invoice.created_at,
  };
}

const WITH_DETAILS = { buyer: true, lines: true };

async function listInvoices(userId) {
  const invoices = await prisma.invoice.findMany({ where: { user_id: userId }, include: WITH_DETAILS, orderBy: { created_at: 'desc' } });
  return invoices.map((invoice) => present(invoice));
}

async function findInvoice(client, userId, id) {
  const invoice = await client.invoice.findFirst({ where: { id, user_id: userId }, include: WITH_DETAILS });
  if (!invoice) throw notFound();
  return invoice;
}

async function getInvoice(userId, id) {
  return present(await findInvoice(prisma, userId, id));
}

async function requireBuyer(client, userId, buyerId) {
  const buyer = await client.buyer.findFirst({ where: { id: buyerId, user_id: userId } });
  if (!buyer) throw fail('Buyer not found', 404);
  return buyer;
}

// Which of these sales sit on an invoice that still counts (not cancelled),
// other than `exceptInvoiceId`. Returns a Set of sale ids.
async function salesAlreadyInvoiced(client, userId, saleIds, exceptInvoiceId = null) {
  if (!saleIds.length) return new Set();
  const lines = await client.invoiceLine.findMany({ where: { sale_id: { in: saleIds } }, include: { invoice: true } });
  return new Set(lines
    .filter((line) => line.invoice && line.invoice.user_id === userId && line.invoice.status !== 'CANCELLED' && line.invoice.id !== exceptInvoiceId)
    .map((line) => line.sale_id));
}

// This buyer's sales that can go on an invoice: the user's own, not cancelled
// or voided, and not already invoiced. Newest first.
async function billableSales(userId, buyerId, { exceptInvoiceId = null, client = prisma } = {}) {
  await requireBuyer(client, userId, buyerId);
  const sales = await client.sales.findMany({
    where: { buyer_id: buyerId, inventory: { user_id: userId }, cancelled_at: null, voided_at: null },
    include: { inventory: true },
    orderBy: { sale_date: 'desc' },
  });
  const taken = await salesAlreadyInvoiced(client, userId, sales.map((sale) => sale.id), exceptInvoiceId);
  return sales.filter((sale) => !taken.has(sale.id)).map((sale) => {
    const line = lineFromSale(sale, 0);
    return {
      sale_id: sale.id,
      description: line.description,
      quantity: line.quantity,
      unit_price: money(line.unit_price),
      amount: money(line.amount),
      tax: money(line.tax),
      sale_date: dayOf(sale.sale_date),
    };
  });
}

// The lines for a set of sale ids, in the order given. Every sale must be this
// user's, sold to this buyer, still standing, and not on another invoice.
async function linesForSales(client, userId, buyerId, saleIds, exceptInvoiceId = null) {
  const ids = [...new Set(saleIds)];
  if (!ids.length) throw fail('Pick at least one sale for the invoice.');
  if (ids.length > MAX_LINES) throw fail(`An invoice can hold up to ${MAX_LINES} sales.`);
  // Hold the sale rows until this save finishes, so two invoices saved at the
  // same moment can't both take the same sale: the second waits, then sees it
  // is taken.
  await client.$queryRaw`SELECT id FROM "Sales" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
  const sales = await client.sales.findMany({
    where: { id: { in: ids }, inventory: { user_id: userId } },
    include: { inventory: true },
  });
  const byId = new Map(sales.map((sale) => [sale.id, sale]));
  for (const id of ids) {
    const sale = byId.get(id);
    if (!sale) throw fail('One of those sales was not found.', 404);
    if (sale.buyer_id !== buyerId) throw fail('Every sale on an invoice must be to the invoice\'s buyer.');
    if (sale.cancelled_at || sale.voided_at) throw fail('A cancelled or voided sale can\'t be invoiced.');
  }
  const taken = await salesAlreadyInvoiced(client, userId, ids, exceptInvoiceId);
  if (taken.size) throw fail('One of those sales is already on another invoice.', 409);
  return ids.map((id, position) => lineFromSale(byId.get(id), position));
}

function checkDates(issue, due) {
  if (due < issue) throw fail('The due date can\'t be before the invoice date.');
}

const totalFields = (lines) => {
  const { tax, total } = totals(lines);
  return { tax_amount: tax.toFixed(2), total_amount_decimal: total.toFixed(2), total_amount: Number(total.toFixed(2)) };
};

async function createInvoice(userId, { buyer_id: buyerId, sale_ids: saleIds, issue_date: issueDate, due_date: dueDate, notes }) {
  checkDates(issueDate, dueDate);
  // The number is the user's highest plus one; if two saves race for the same
  // number the unique key refuses one, and it tries again with the next.
  for (let attempt = 0; ; attempt += 1) {
    try {
      const id = await prisma.$transaction(async (tx) => {
        await requireBuyer(tx, userId, buyerId);
        const lines = await linesForSales(tx, userId, buyerId, saleIds);
        const [latest] = await tx.invoice.findMany({ where: { user_id: userId, number: { not: null } }, orderBy: { number: 'desc' }, take: 1 });
        const invoice = await tx.invoice.create({
          data: {
            user_id: userId,
            buyer_id: buyerId,
            number: (latest?.number || 0) + 1,
            issue_date: toDate(issueDate),
            due_date: toDate(dueDate),
            status: 'DRAFT',
            created_at: new Date(),
            notes: notes || null,
            ...totalFields(lines),
          },
        });
        await tx.invoiceLine.createMany({ data: lines.map((line) => ({ ...line, invoice_id: invoice.id })) });
        return invoice.id;
      });
      return getInvoice(userId, id);
    } catch (err) {
      if (!isUniqueError(err) || attempt >= 3) throw err;
    }
  }
}

// Dates, notes and status can change at any time. The sales on it can only
// change while it is a draft: a sent invoice is a document someone has.
async function updateInvoice(userId, id, changes) {
  await prisma.$transaction(async (tx) => {
    const invoice = await findInvoice(tx, userId, id);
    const data = {};
    const issue = changes.issue_date ?? dayOf(invoice.issue_date);
    const due = changes.due_date ?? dayOf(invoice.due_date);
    if (changes.issue_date !== undefined || changes.due_date !== undefined) {
      checkDates(issue, due);
      data.issue_date = toDate(issue);
      data.due_date = toDate(due);
    }
    if (changes.notes !== undefined) data.notes = changes.notes || null;
    if (changes.status !== undefined) {
      if (!STATUSES.includes(changes.status)) throw fail('Unknown invoice status.');
      // Bringing a cancelled invoice back: its sales may have gone elsewhere.
      if (invoice.status === 'CANCELLED' && changes.status !== 'CANCELLED') {
        const saleIds = invoice.lines.map((line) => line.sale_id).filter(Boolean);
        const taken = await salesAlreadyInvoiced(tx, userId, saleIds, invoice.id);
        if (taken.size) throw fail('Some of this invoice\'s sales are now on another invoice, so it can\'t be reopened.', 409);
      }
      data.status = changes.status;
    }
    if (changes.sale_ids !== undefined) {
      if (invoice.status !== 'DRAFT') throw fail('Only a draft invoice\'s sales can be changed.', 409);
      const lines = await linesForSales(tx, userId, invoice.buyer_id, changes.sale_ids, invoice.id);
      await tx.invoiceLine.deleteMany({ where: { invoice_id: invoice.id } });
      await tx.invoiceLine.createMany({ data: lines.map((line) => ({ ...line, invoice_id: invoice.id })) });
      Object.assign(data, totalFields(lines));
    }
    if (Object.keys(data).length) await tx.invoice.update({ where: { id: invoice.id }, data: { ...data, updated_at: new Date() } });
  });
  return getInvoice(userId, id);
}

async function deleteInvoice(userId, id) {
  await prisma.$transaction(async (tx) => {
    const invoice = await findInvoice(tx, userId, id);
    await tx.invoiceLine.deleteMany({ where: { invoice_id: invoice.id } });
    await tx.invoice.delete({ where: { id: invoice.id } });
  });
  return { deleted: true };
}

module.exports = { STATUSES, listInvoices, getInvoice, billableSales, createInvoice, updateInvoice, deleteInvoice, lineFromSale, present };
