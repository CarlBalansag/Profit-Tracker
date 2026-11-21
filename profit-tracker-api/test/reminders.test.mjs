import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const reminders = require('../services/reminders.js');
const { buildCalendarFeed } = require('../services/calendarFeed.js');

let server;
let baseUrl;

beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());

const TODAY = new Date().toISOString().slice(0, 10);
const dayStr = (offset) => new Date(Date.parse(`${TODAY}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);

const request = async (method, path, body, headers = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};
const create = (fields) => request('POST', '/api/reminders', { title: 'Call Amex about the credit', due_date: TODAY, ...fields });
const todos = () => request('GET', `/api/todos?today=${TODAY}`);
const { ids } = harness;
const FOREIGN_CARD = '99999999-9999-4999-8999-999999999990';

beforeEach(() => {
  harness.reset();
  // Keep the fixture's own to-dos out of the way: nothing due, nothing unshipped.
  harness.db.sales = [];
  Object.assign(harness.db.paymentMethod[0], { due_day: null, statement_close_day: null, credit_limit: 5000 });
  harness.db.paymentMethod[0].due_day = Number(dayStr(15).slice(8, 10));
  harness.db.paymentMethod[0].statement_close_day = Number(dayStr(-15).slice(8, 10));
  harness.db.paymentMethod.push({ id: FOREIGN_CARD, user_id: ids.other, name: 'Someone else', type: 'Credit' });
});

describe('creating reminders', () => {
  it('saves a reminder with its time, repeat, notes and card', async () => {
    const res = await create({ due_time: '15:30', repeat: 'monthly', notes: 'Ask for the $50 credit', payment_method_id: ids.card });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: 'Call Amex about the credit', due_date: TODAY, due_time: '15:30', repeat: 'monthly', repeat_from: TODAY,
      notes: 'Ask for the $50 credit', payment_method: { id: ids.card, name: 'QA Credit Card' }, done_at: null,
    });
    expect(harness.db.reminder).toHaveLength(1);
  });

  it('defaults to a one-off with no time and treats blank optional fields as empty', async () => {
    const res = await create({ due_time: '', notes: '  ', payment_method_id: '' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ repeat: 'none', repeat_from: null, due_time: null, notes: null, payment_method_id: null });
  });

  it('rejects bad input without saving anything', async () => {
    const bad = await Promise.all([
      create({ title: '   ' }),
      create({ title: 'x'.repeat(201) }),
      create({ due_date: '2026-02-30' }),
      create({ due_date: 'tomorrow' }),
      create({ due_time: '25:00' }),
      create({ repeat: 'hourly' }),
      create({ notes: 'x'.repeat(1001) }),
      create({ payment_method_id: 'not-a-uuid' }),
      create({ surprise: true }),
    ]);
    expect(bad.map((res) => res.status)).toEqual([400, 400, 400, 400, 400, 400, 400, 400, 400]);
    expect(harness.db.reminder).toHaveLength(0);
  });

  it('refuses another user\'s card', async () => {
    const res = await create({ payment_method_id: FOREIGN_CARD });
    expect(res.status).toBe(404);
    expect(harness.db.reminder).toHaveLength(0);
  });

  it('requires a signed-in user', async () => {
    const res = await request('POST', '/api/reminders', { title: 'x', due_date: TODAY }, { 'x-qa-unauthenticated': 'true' });
    expect(res.status).toBe(401);
  });
});

describe('listing, editing and deleting', () => {
  it('lists open reminders soonest first, and done ones separately', async () => {
    await create({ title: 'Later', due_date: dayStr(5) });
    await create({ title: 'Sooner', due_date: dayStr(1) });
    const done = await create({ title: 'Finished', due_date: dayStr(-1) });
    await request('POST', `/api/reminders/${done.body.id}/complete`, { today: TODAY });
    harness.db.reminder.push({ id: 'aaaaaaaa-0000-4000-8000-000000000001', user_id: ids.other, title: 'PRIVATE', due_date: TODAY, repeat: 'none', done_at: null });

    const open = await request('GET', '/api/reminders');
    expect(open.body.map((r) => r.title)).toEqual(['Sooner', 'Later']);
    const finished = await request('GET', '/api/reminders?status=done');
    expect(finished.body.map((r) => r.title)).toEqual(['Finished']);
  });

  it('edits only the fields sent, and clears optional ones', async () => {
    const made = await create({ due_time: '09:00', notes: 'keep?', repeat: 'weekly', payment_method_id: ids.card });
    const res = await request('PATCH', `/api/reminders/${made.body.id}`, { title: 'Call Chase instead', notes: null, payment_method_id: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: 'Call Chase instead', notes: null, payment_method_id: null, due_time: '09:00', repeat: 'weekly', due_date: TODAY });
  });

  it('restarts the repeat count from a new date', async () => {
    const made = await create({ repeat: 'monthly' });
    const res = await request('PATCH', `/api/reminders/${made.body.id}`, { due_date: '2027-01-31' });
    expect(res.body.repeat_from).toBe('2027-01-31');
    const once = await request('PATCH', `/api/reminders/${made.body.id}`, { repeat: 'none' });
    expect(once.body.repeat_from).toBeNull();
  });

  it('rejects empty and invalid edits, and other users\' reminders', async () => {
    const made = await create({});
    harness.db.reminder.push({ id: 'aaaaaaaa-0000-4000-8000-000000000002', user_id: ids.other, title: 'PRIVATE', due_date: TODAY, repeat: 'none', done_at: null });
    const results = await Promise.all([
      request('PATCH', `/api/reminders/${made.body.id}`, {}),
      request('PATCH', `/api/reminders/${made.body.id}`, { due_date: 'soon' }),
      request('PATCH', `/api/reminders/${made.body.id}`, { payment_method_id: FOREIGN_CARD }),
      request('PATCH', '/api/reminders/aaaaaaaa-0000-4000-8000-000000000002', { title: 'mine now' }),
      request('DELETE', '/api/reminders/aaaaaaaa-0000-4000-8000-000000000002'),
      request('POST', '/api/reminders/aaaaaaaa-0000-4000-8000-000000000002/complete', {}),
    ]);
    expect(results.map((res) => res.status)).toEqual([400, 400, 404, 404, 404, 404]);
    expect(harness.db.reminder.find((r) => r.user_id === ids.other)).toMatchObject({ title: 'PRIVATE', done_at: null });
    expect(harness.db.reminder.find((r) => r.id === made.body.id).payment_method_id).toBeNull();
  });

  it('deletes a reminder', async () => {
    const made = await create({});
    const res = await request('DELETE', `/api/reminders/${made.body.id}`);
    expect(res).toMatchObject({ status: 200, body: { deleted: true } });
    expect(harness.db.reminder).toHaveLength(0);
  });

  it('keeps the reminder when saving fails', async () => {
    const made = await create({});
    harness.faults['reminder.update'] = true;
    const res = await request('PATCH', `/api/reminders/${made.body.id}`, { title: 'changed' });
    expect(res.status).toBe(500);
    expect(harness.db.reminder[0].title).toBe('Call Amex about the credit');
  });

  it('republishes the phone calendar feed after each change', async () => {
    const made = await create({});
    await request('PATCH', `/api/reminders/${made.body.id}`, { title: 'x' });
    await request('POST', `/api/reminders/${made.body.id}/complete`, { today: TODAY });
    await request('DELETE', `/api/reminders/${made.body.id}`);
    expect(harness.calls.filter((c) => c.model === 'cloudinary' && c.op === 'upload')).toHaveLength(4);
  });
});

describe('completing', () => {
  it('finishes a one-off reminder, and Undo opens it again', async () => {
    const made = await create({});
    const done = await request('POST', `/api/reminders/${made.body.id}/complete`, { today: TODAY });
    expect(done.status).toBe(200);
    expect(done.body.reminder.done_at).not.toBeNull();
    expect(done.body.previous).toEqual({ due_date: TODAY });

    const again = await request('POST', `/api/reminders/${made.body.id}/complete`, { today: TODAY });
    expect(again.status).toBe(409);

    const undone = await request('POST', `/api/reminders/${made.body.id}/undo-complete`, done.body.previous);
    expect(undone.body).toMatchObject({ done_at: null, due_date: TODAY });
  });

  it('moves a repeating reminder to its next date, catching up on missed ones', async () => {
    const weekly = await create({ repeat: 'weekly', due_date: dayStr(-15) });
    const res = await request('POST', `/api/reminders/${weekly.body.id}/complete`, { today: TODAY });
    expect(res.body.reminder).toMatchObject({ due_date: dayStr(6), done_at: null });
    // Undo puts the old date back without moving where the repeat counts from.
    const undone = await request('POST', `/api/reminders/${weekly.body.id}/undo-complete`, res.body.previous);
    expect(undone.body).toMatchObject({ due_date: dayStr(-15), repeat_from: dayStr(-15) });
  });

  it('only moves a reminder once when Done is tapped twice', async () => {
    const made = await create({ repeat: 'weekly' });
    const tap = () => request('POST', `/api/reminders/${made.body.id}/complete`, { today: TODAY, due_date: TODAY });
    const results = [await tap(), await tap()];
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(harness.db.reminder[0].due_date).toBe(dayStr(7));
  });

  it('rejects a bad undo date', async () => {
    const made = await create({});
    const res = await request('POST', `/api/reminders/${made.body.id}/undo-complete`, { due_date: 'yesterday' });
    expect(res.status).toBe(400);
  });
});

describe('repeat dates', () => {
  it('keeps a monthly reminder on its day after a short month', () => {
    const rem = { repeat: 'monthly', due_date: '2027-01-31', repeat_from: '2027-01-31' };
    expect(reminders.stepOnce('2027-01-31', 'monthly', rem.repeat_from)).toBe('2027-02-28');
    expect(reminders.stepOnce('2027-02-28', 'monthly', rem.repeat_from)).toBe('2027-03-31');
    expect(reminders.nextDueDate(rem, '2027-02-01')).toBe('2027-02-28');
  });

  it('steps weekly, every 2 weeks and yearly (leap days too)', () => {
    expect(reminders.stepOnce('2026-12-29', 'weekly')).toBe('2027-01-05');
    expect(reminders.stepOnce('2026-12-29', 'biweekly')).toBe('2027-01-12');
    expect(reminders.stepOnce('2028-02-29', 'yearly', '2028-02-29')).toBe('2029-02-28');
    expect(reminders.stepOnce('2029-02-28', 'yearly', '2028-02-29')).toBe('2030-02-28');
    expect(reminders.nextDueDate({ repeat: 'none', due_date: '2026-01-01' }, '2026-11-21')).toBeNull();
  });

  it('lists occurrences within a window', () => {
    const rem = { repeat: 'biweekly', due_date: '2026-11-01', repeat_from: '2026-11-01' };
    expect(reminders.occurrences(rem, '2026-11-10', '2026-12-31')).toEqual(['2026-11-15', '2026-11-29', '2026-12-13', '2026-12-27']);
    expect(reminders.occurrences({ repeat: 'none', due_date: '2026-11-05' }, '2026-11-10', '2026-12-31')).toEqual([]);
  });
});

describe('on the To-Do list', () => {
  it('shows reminders from 3 days before they are due, by urgency', async () => {
    await create({ title: 'Overdue one', due_date: dayStr(-2) });
    await create({ title: 'Today one', due_date: TODAY, due_time: '15:30', payment_method_id: ids.card, repeat: 'weekly' });
    await create({ title: 'Soon one', due_date: dayStr(3) });
    await create({ title: 'Far one', due_date: dayStr(4) });
    const finished = await create({ title: 'Done one', due_date: TODAY });
    await request('POST', `/api/reminders/${finished.body.id}/complete`, { today: TODAY });

    const { body } = await todos();
    const mine = body.items.filter((entry) => entry.type === 'reminder');
    expect(mine.map((entry) => [entry.title, entry.urgency])).toEqual([['Overdue one', 'overdue'], ['Today one', 'today'], ['Soon one', 'soon']]);
    expect(mine[1]).toMatchObject({
      group: 'reminders',
      detail: 'Due today at 3:30 PM · Every week · QA Credit Card',
      actions: ['complete', 'snooze', 'edit'],
      link: { kind: 'page', to: '/creditcard' },
      reminder: { due_time: '15:30', repeat: 'weekly' },
    });
    expect(mine[0].detail).toBe('Was due 2 days ago');
    expect(body.counts.reminders).toBe(3);
  });

  it('snoozes one occurrence without hiding the next', async () => {
    const made = await create({ repeat: 'weekly', due_date: TODAY });
    const key = `reminder:${made.body.id}:${TODAY}`;
    await request('POST', '/api/todos/state', { key, action: 'snooze', until: dayStr(1), today: TODAY });
    expect((await todos()).body.items.filter((entry) => entry.type === 'reminder')).toEqual([]);
    // Completing moves it a week out, past the list's 3-day window.
    await request('POST', `/api/reminders/${made.body.id}/complete`, { today: TODAY });
    harness.db.reminder[0].due_date = dayStr(2);
    expect((await todos()).body.items.filter((entry) => entry.type === 'reminder')).toHaveLength(1);
  });
});

describe('on the Calendar and the phone feed', () => {
  it('adds each occurrence to the Calendar month, never done ones', async () => {
    const month = TODAY.slice(0, 7);
    await create({ title: 'Weekly check', repeat: 'weekly', due_date: TODAY, due_time: '08:00' });
    const finished = await create({ title: 'Done', due_date: TODAY });
    await request('POST', `/api/reminders/${finished.body.id}/complete`, { today: TODAY });
    const res = await request('GET', `/api/calendar-events/auto?month=${month}`);
    const mine = res.body.filter((ev) => ev.type === 'reminder');
    expect(mine.length).toBeGreaterThanOrEqual(4);
    expect(mine[0]).toMatchObject({ title: 'Weekly check (08:00)', date: TODAY });
    expect(mine.map((ev) => ev.title)).not.toContain('Done');
  });

  it('puts reminders in the phone feed with an alert', async () => {
    await create({ title: 'Pay rent; call landlord', due_date: '2099-01-01', due_time: '23:45' });
    await create({ title: 'All day thing', due_date: dayStr(1) });
    const feed = await buildCalendarFeed(ids.user);
    // Far future is outside the feed's year ahead.
    expect(feed).not.toContain('Pay rent');
    const allDay = dayStr(1).replace(/-/g, '');
    expect(feed).toContain(`DTSTART;VALUE=DATE:${allDay}`);
    expect(feed).toContain('SUMMARY:Reminder: All day thing');
    expect(feed).toContain('TRIGGER:PT9H');

    harness.db.reminder[0].due_date = dayStr(2);
    const timed = await buildCalendarFeed(ids.user);
    const day = dayStr(2).replace(/-/g, '');
    expect(timed).toContain(`DTSTART:${day}T234500`);
    expect(timed).toContain(`DTEND:${dayStr(3).replace(/-/g, '')}T001500`); // half an hour, past midnight
    expect(timed).toContain('SUMMARY:Reminder: Pay rent\\; call landlord');
    expect(timed).toContain('TRIGGER:PT0M');
  });
});
