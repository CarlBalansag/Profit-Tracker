// Per-transaction notes for the website. Same storage and change history as
// the MCP note tools (services/transactionNotes.js); notes written here are
// authored 'carl' and their ChangeLog rows carry source 'web'.
const express = require('express');
const router = express.Router();
const { z } = require('zod');
const prisma = require('../prisma');
const notes = require('../services/transactionNotes');

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

const uuid = z.string().uuid();
const isUuid = (value) => uuid.safeParse(value).success;
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

function requireEntity(entityType, entityId) {
  if (!notes.ENTITY_TYPES.includes(entityType)) throw badRequest(`entity_type must be one of: ${notes.ENTITY_TYPES.join(', ')}`);
  if (!isUuid(entityId)) throw badRequest('entity_id must be a valid id');
}
function requirePinned(pinned) {
  if (pinned !== undefined && typeof pinned !== 'boolean') throw badRequest('pinned must be true or false');
}
function requireNoteId(id) {
  if (!isUuid(id)) throw badRequest('Invalid note id');
}

// Known validation/ownership failures answer with their own status; anything
// else goes to the app's error handler.
function handle(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err.status === 400 || err.status === 404) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  };
}

// GET /api/transaction-notes?entity_type=sale|purchase&entity_id=...
// Non-deleted notes for one owned sale/purchase, pinned first, newest first.
router.get('/', isAuthenticated, handle(async (req, res) => {
  const { entity_type, entity_id } = req.query;
  requireEntity(entity_type, entity_id);
  await notes.requireOwnedEntity(prisma, req.user.id, entity_type, entity_id);
  const rows = await notes.listEntityNotes(prisma, req.user.id, entity_type, entity_id);
  res.json(rows.map(notes.serializeNote));
}));

// POST /api/transaction-notes  { entity_type, entity_id, body, pinned? }
router.post('/', isAuthenticated, handle(async (req, res) => {
  const { entity_type, entity_id, body, pinned } = req.body || {};
  requireEntity(entity_type, entity_id);
  requirePinned(pinned);
  notes.cleanBody(body);
  const { note } = await prisma.$transaction((tx) => notes.createNote(
    tx, req.user.id, { entity_type, entity_id, body, pinned, author: 'carl' }, 'web',
  ));
  res.status(201).json(notes.serializeNote(note));
}));

// PATCH /api/transaction-notes/:id  { body?, pinned? }
router.patch('/:id', isAuthenticated, handle(async (req, res) => {
  requireNoteId(req.params.id);
  const { body, pinned } = req.body || {};
  if (body === undefined && pinned === undefined) throw badRequest('Provide body and/or pinned');
  requirePinned(pinned);
  if (body !== undefined) notes.cleanBody(body);
  const note = await prisma.$transaction((tx) => notes.updateNote(tx, req.user.id, req.params.id, { body, pinned }, 'web'));
  res.json(notes.serializeNote(note));
}));

// DELETE /api/transaction-notes/:id  (soft delete)
router.delete('/:id', isAuthenticated, handle(async (req, res) => {
  requireNoteId(req.params.id);
  await prisma.$transaction((tx) => notes.deleteNote(tx, req.user.id, req.params.id, 'web'));
  res.json({ success: true });
}));

module.exports = router;
