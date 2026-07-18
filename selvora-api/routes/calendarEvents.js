const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { randomUUID } = require('crypto');

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Returns the first and last day of a month string (YYYY-MM), expanded by 1 month
// so week-view edges are covered.
function monthRange(monthStr) {
  if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) {
    const now = new Date();
    monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  const [year, month] = monthStr.split('-').map(Number);
  // Start = first day of previous month
  const start = new Date(year, month - 2, 1);
  // End = last day of next month
  const end = new Date(year, month + 1, 0);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

// Format a JS Date or DateTime as YYYY-MM-DD
function toDateStr(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().slice(0, 10);
}

// ─── IMPORTANT: /auto and /feed.ics must be defined BEFORE /:id ──────────────

// GET /api/calendar-events/auto?month=YYYY-MM
// Returns auto-generated events from Inventory + Sales (not stored in DB)
router.get('/auto', isAuthenticated, async (req, res, next) => {
  try {
    const { month } = req.query;
    const { start, end } = monthRange(month);

    const [inventories, sales, creditPurchases] = await Promise.all([
      // Purchase events
      prisma.inventory.findMany({
        where: {
          user_id: req.user.id,
          purchase_date: {
            gte: new Date(start),
            lte: new Date(end + 'T23:59:59Z'),
          },
        },
        select: { id: true, product_name: true, purchase_date: true },
      }),
      // Sale + payout events
      prisma.sales.findMany({
        where: {
          inventory: { user_id: req.user.id },
          OR: [
            {
              sale_date: {
                gte: new Date(start),
                lte: new Date(end + 'T23:59:59Z'),
              },
            },
            {
              payout_date: {
                gte: new Date(start),
                lte: new Date(end + 'T23:59:59Z'),
              },
            },
          ],
        },
        select: {
          id: true,
          sale_date: true,
          payout_date: true,
          inventory: { select: { product_name: true } },
        },
      }),
      // All credit card purchases — due date is computed in JS, so we fetch all and filter after
      prisma.inventory.findMany({
        where: {
          user_id: req.user.id,
          payment_method: { type: 'Credit' },
        },
        select: {
          id: true,
          product_name: true,
          purchase_date: true,
          qty_purchased: true,
          unit_purchase_cost: true,
          sales_tax: true,
          shipping_cost_inbound: true,
          payment_method: {
            select: { due_day: true },
          },
        },
      }),
    ]);

    const events = [];

    for (const inv of inventories) {
      events.push({
        id: `purchase_${inv.id}`,
        title: inv.product_name,
        date: toDateStr(inv.purchase_date),
        type: 'purchase',
        color: null,
        notes: null,
      });
    }

    // Credit card due events
    for (const inv of creditPurchases) {
      const purchaseDate = new Date(inv.purchase_date);
      let dueDate;

      if (inv.payment_method?.due_day) {
        // Use the card's actual due day — next month after the purchase
        const dueMonth = purchaseDate.getMonth() + 1; // 0-indexed + 1 = next month (0-indexed)
        const dueYear = purchaseDate.getFullYear() + (dueMonth > 11 ? 1 : 0);
        dueDate = new Date(dueYear, dueMonth % 12, inv.payment_method.due_day);
      } else {
        // Fall back to 30 days after purchase
        dueDate = new Date(purchaseDate);
        dueDate.setDate(dueDate.getDate() + 30);
      }

      const dueDateStr = toDateStr(dueDate);
      // Only include if the due date falls within our window
      if (dueDateStr >= start && dueDateStr <= end) {
        const costBasis = (inv.unit_purchase_cost * inv.qty_purchased) + (inv.sales_tax || 0) + (inv.shipping_cost_inbound || 0);
        events.push({
          id: `cc_due_${inv.id}`,
          title: `CC Due: ${inv.product_name} ($${costBasis.toFixed(2)})`,
          date: dueDateStr,
          type: 'credit_due',
          color: null,
          notes: null,
        });
      }
    }

    for (const sale of sales) {
      const name = sale.inventory.product_name;
      if (sale.sale_date) {
        const saleDate = toDateStr(sale.sale_date);
        if (saleDate >= start && saleDate <= end) {
          events.push({
            id: `sale_${sale.id}`,
            title: name,
            date: saleDate,
            type: 'sale',
            color: null,
            notes: null,
          });
        }
      }
      if (sale.payout_date) {
        const payoutDate = toDateStr(sale.payout_date);
        if (payoutDate >= start && payoutDate <= end) {
          events.push({
            id: `payout_${sale.id}`,
            title: name,
            date: payoutDate,
            type: 'payout',
            color: null,
            notes: null,
          });
        }
      }
    }

    events.sort((a, b) => a.date.localeCompare(b.date));
    res.json(events);
  } catch (err) {
    next(err);
  }
});

// POST /api/calendar-events/token
// Generate or return the user's personal calendar subscribe token
router.post('/token', isAuthenticated, async (req, res, next) => {
  try {
    let user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { calendar_token: true },
    });

    let token = user.calendar_token;
    if (!token) {
      token = randomUUID();
      await prisma.user.update({
        where: { id: req.user.id },
        data: { calendar_token: token },
      });
    }

    const baseUrl = process.env.BACKEND_URL || 'http://localhost:3000';
    const feedUrl = `${baseUrl}/api/calendar-events/feed.ics?token=${token}`;

    res.json({ token, feedUrl });
  } catch (err) {
    next(err);
  }
});

// GET /api/calendar-events/feed.ics?token=XXX
// Live .ics feed — NO session auth, token-based only.
// Google/Apple Calendar subscribes to this URL and polls periodically.
router.get('/feed.ics', async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(401).send('Missing token');

    const user = await prisma.user.findUnique({
      where: { calendar_token: token },
      select: { id: true },
    });
    if (!user) return res.status(401).send('Invalid token');

    // Fetch all data (no date limit — full history for the feed)
    const [manualEvents, inventories, sales] = await Promise.all([
      prisma.calendarEvent.findMany({
        where: { user_id: user.id },
        orderBy: { date: 'asc' },
      }),
      prisma.inventory.findMany({
        where: {
          user_id: user.id,
          purchase_date: { gte: new Date(new Date().getFullYear() - 1, 0, 1) },
        },
        select: { id: true, product_name: true, purchase_date: true },
      }),
      prisma.sales.findMany({
        where: {
          inventory: { user_id: user.id },
          sale_date: { gte: new Date(new Date().getFullYear() - 1, 0, 1) },
        },
        select: {
          id: true,
          sale_date: true,
          payout_date: true,
          inventory: { select: { product_name: true } },
        },
      }),
    ]);

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Selvora//Reselling Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Selvora Reselling Calendar',
      'REFRESH-INTERVAL;VALUE=DURATION:PT3H',
      'X-PUBLISHED-TTL:PT3H',
    ];

    const addEvent = (uid, dtstart, summary, description) => {
      // dtstart is YYYY-MM-DD; convert to YYYYMMDD for DATE format
      const start = dtstart.replace(/-/g, '');
      // DTEND for all-day = next day
      const endDate = new Date(dtstart + 'T00:00:00Z');
      endDate.setUTCDate(endDate.getUTCDate() + 1);
      const end = endDate.toISOString().slice(0, 10).replace(/-/g, '');

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${uid}@selvora`);
      lines.push(`DTSTART;VALUE=DATE:${start}`);
      lines.push(`DTEND;VALUE=DATE:${end}`);
      lines.push(`SUMMARY:${escapeIcs(summary)}`);
      if (description) lines.push(`DESCRIPTION:${escapeIcs(description)}`);
      lines.push('END:VEVENT');
    };

    // Manual events
    for (const ev of manualEvents) {
      addEvent(ev.id, ev.date, ev.title, ev.notes || '');
    }

    // Purchase events
    for (const inv of inventories) {
      const d = toDateStr(inv.purchase_date);
      if (d) addEvent(`purchase_${inv.id}`, d, `Purchase: ${inv.product_name}`, '');
    }

    // Sale + payout events
    for (const sale of sales) {
      const name = sale.inventory.product_name;
      if (sale.sale_date) {
        addEvent(`sale_${sale.id}`, toDateStr(sale.sale_date), `Sale: ${name}`, '');
      }
      if (sale.payout_date) {
        addEvent(`payout_${sale.id}`, toDateStr(sale.payout_date), `Payout: ${name}`, '');
      }
    }

    lines.push('END:VCALENDAR');

    const body = lines.join('\r\n');
    // No Content-Disposition — subscribe feeds must not force a download
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.send(body);
  } catch (err) {
    next(err);
  }
});

function escapeIcs(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

// ─── CRUD for manual events ───────────────────────────────────────────────────

// GET /api/calendar-events?month=YYYY-MM
router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    const { month } = req.query;
    const { start, end } = monthRange(month);

    const events = await prisma.calendarEvent.findMany({
      where: {
        user_id: req.user.id,
        date: { gte: start, lte: end },
      },
      orderBy: { date: 'asc' },
    });

    res.json(events);
  } catch (err) {
    next(err);
  }
});

// POST /api/calendar-events
router.post('/', isAuthenticated, async (req, res, next) => {
  try {
    const { title, date, end_date, color, notes } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    const event = await prisma.calendarEvent.create({
      data: {
        user_id: req.user.id,
        title: title.trim(),
        date,
        end_date: end_date || null,
        color: color || null,
        notes: notes || null,
      },
    });

    res.status(201).json(event);
  } catch (err) {
    next(err);
  }
});

// PUT /api/calendar-events/:id
router.put('/:id', isAuthenticated, async (req, res, next) => {
  try {
    const existing = await prisma.calendarEvent.findUnique({
      where: { id: req.params.id },
    });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    const { title, date, end_date, color, notes } = req.body;
    const updated = await prisma.calendarEvent.update({
      where: { id: req.params.id },
      data: {
        ...(title !== undefined && { title: title.trim() }),
        ...(date !== undefined && { date }),
        ...(end_date !== undefined && { end_date: end_date || null }),
        ...(color !== undefined && { color: color || null }),
        ...(notes !== undefined && { notes: notes || null }),
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/calendar-events/:id
router.delete('/:id', isAuthenticated, async (req, res, next) => {
  try {
    const existing = await prisma.calendarEvent.findUnique({
      where: { id: req.params.id },
    });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    await prisma.calendarEvent.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
