// Saved cards linked to the card list (catalog_card_id), shared by the
// website's /api/payment-methods routes and the AI assistant's tools
// (routes/mcp.js) so both read and write cards the same way.
const { fieldsFromCatalog, refreshFromCatalog } = require('./catalogCardFields');
const { getCatalogIndex } = require('./cardCatalog');

// Keeps cards added from the card catalog current: when the catalog's data
// for a card changed since it was last copied, update the saved card (the
// user's own edits are kept -- see services/catalogCardFields.js). Runs on
// every card list load, so a monthly catalog refresh or a newer bundled copy
// reaches users the next time their cards load. A failure here never blocks
// loading cards.
async function autoUpdateFromCatalog(prisma, methods, userId) {
  const linked = methods.filter(m => m.catalog_card_id);
  if (!linked.length) return methods;
  try {
    const byId = await getCatalogIndex(prisma);
    const updatedById = new Map();
    for (const method of linked) {
      const data = refreshFromCatalog(method, byId.get(method.catalog_card_id));
      if (!data) continue;
      // Scoped to the user's own row; count 0 means it was deleted meanwhile.
      const { count } = await prisma.paymentMethod.updateMany({ where: { id: method.id, user_id: userId }, data });
      // Re-read rather than merging: the database trigger recomputes the
      // exact Decimal columns that responses prefer over the Floats.
      if (count) {
        const fresh = await prisma.paymentMethod.findFirst({ where: { id: method.id, user_id: userId } });
        if (fresh) updatedById.set(method.id, fresh);
      }
    }
    return methods.map(m => updatedById.get(m.id) || m);
  } catch (err) {
    console.warn('[linkedCards] catalog auto-update failed:', err.message);
    return methods;
  }
}

// When a request asks to take a card's rewards from the catalog
// (apply_catalog), fill the reward fields from the catalog card. Store rates
// sent along are the user's own and win over the catalog's for that store.
// The catalog bookkeeping fields are only ever written by the server.
async function withCatalogFields(prisma, rawBody) {
  const { catalog_applied: _a, catalog_synced_at: _s, ...body } = rawBody;
  if (!body.apply_catalog) return body;
  const byId = await getCatalogIndex(prisma);
  const card = byId.get(body.catalog_card_id);
  if (!card) {
    const err = new Error('That card is not in the card list');
    err.status = 400;
    throw err;
  }
  return {
    ...body,
    ...fieldsFromCatalog(card, {
      includeStoreRates: body.include_store_rates !== false,
      userRates: body.category_rates || [],
    }),
  };
}

module.exports = { autoUpdateFromCatalog, withCatalogFields };
