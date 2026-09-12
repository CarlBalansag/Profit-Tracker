const cloudinary = require('cloudinary').v2;
const prisma = require('../prisma');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function toDateStr(value) {
  if (!value) return null;
  return new Date(value).toISOString().slice(0, 10);
}

function escapeIcs(value) {
  if (!value) return '';
  return String(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function getCalendarFeedUrl(token) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloudName || !token) return null;
  return `https://res.cloudinary.com/${cloudName}/raw/upload/selvora/calendar-feeds/${token}.ics`;
}

async function buildCalendarFeed(userId) {
  const { batchCost } = await require('./finance');
  const [manualEvents, inventories, sales, creditPurchases] = await Promise.all([
    prisma.calendarEvent.findMany({ where: { user_id: userId }, orderBy: { date: 'asc' } }),
    prisma.inventory.findMany({
      where: { user_id: userId, purchase_date: { gte: new Date(new Date().getFullYear() - 1, 0, 1) } },
      select: { id: true, product_name: true, purchase_date: true },
    }),
    prisma.sales.findMany({
      where: { inventory: { user_id: userId }, sale_date: { gte: new Date(new Date().getFullYear() - 1, 0, 1) } },
      select: { id: true, sale_date: true, payout_date: true, inventory: { select: { product_name: true } } },
    }),
    prisma.inventory.findMany({
      where: { user_id: userId, payment_method: { type: 'Credit' } },
      select: {
        id: true, product_name: true, purchase_date: true, qty_purchased: true, unit_purchase_cost: true,
        sales_tax: true, shipping_cost_inbound: true, fees: true, gift_card_amount: true,
        unit_purchase_cost_decimal: true, sales_tax_decimal: true, shipping_cost_inbound_decimal: true,
        fees_decimal: true, gift_card_amount_decimal: true, payment_method: { select: { due_day: true } },
      },
    }),
  ]);

  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Selvora//Reselling Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  const addEvent = (id, date, summary, description = '') => {
    if (!date) return;
    const start = date.replace(/-/g, '');
    const endDate = new Date(`${date}T00:00:00Z`);
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    lines.push('BEGIN:VEVENT', `UID:${id}@selvora`, `DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${endDate.toISOString().slice(0, 10).replace(/-/g, '')}`, `SUMMARY:${escapeIcs(summary)}`);
    if (description) lines.push(`DESCRIPTION:${escapeIcs(description)}`);
    lines.push('END:VEVENT');
  };

  manualEvents.forEach((event) => addEvent(event.id, event.date, event.title, event.notes));
  inventories.forEach((item) => addEvent(`purchase_${item.id}`, toDateStr(item.purchase_date), `Purchase: ${item.product_name}`));
  sales.forEach((sale) => {
    addEvent(`sale_${sale.id}`, toDateStr(sale.sale_date), `Sale: ${sale.inventory.product_name}`);
    addEvent(`payout_${sale.id}`, toDateStr(sale.payout_date), `Payout: ${sale.inventory.product_name}`);
  });
  creditPurchases.forEach((item) => {
    const purchase = new Date(item.purchase_date);
    const dueDate = item.payment_method?.due_day
      ? new Date(purchase.getFullYear() + (purchase.getMonth() + 1 > 11 ? 1 : 0), (purchase.getMonth() + 1) % 12, item.payment_method.due_day)
      : new Date(purchase.getTime() + 30 * 24 * 60 * 60 * 1000);
    const amount = batchCost(item);
    addEvent(`cc_due_${item.id}`, toDateStr(dueDate), `CC Due: ${item.product_name} ($${amount.toFixed(2)})`);
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

async function publishCalendarFeed(userId, token) {
  const calendarToken = token || (await prisma.user.findUnique({ where: { id: userId }, select: { calendar_token: true } }))?.calendar_token;
  if (!calendarToken) return null;

  try {
    const body = await buildCalendarFeed(userId);
    await cloudinary.uploader.upload(`data:text/calendar;base64,${Buffer.from(body).toString('base64')}`, {
      resource_type: 'raw',
      public_id: `selvora/calendar-feeds/${calendarToken}.ics`,
      overwrite: true,
      invalidate: true,
    });
    return getCalendarFeedUrl(calendarToken);
  } catch (error) {
    console.error('[calendar-feed] publish failed:', error.message);
    return null;
  }
}

module.exports = { buildCalendarFeed, getCalendarFeedUrl, publishCalendarFeed };
