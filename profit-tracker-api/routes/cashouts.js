const express = require('express');
const router = express.Router();
const { validateBody } = require('../middleware/validate');
const {
  createCashoutConnection,
  updateCashoutConnection,
} = require('../validation/schemas');
const { listAvailableCashouts } = require('../services/cashouts/registry');
const {
  listConnections,
  getConnection,
  createConnection,
  updateConnection,
  testConnection,
  deleteConnection,
  fetchConnectionDeals,
  syncUserConnection,
  getDealHistory,
} = require('../services/cashouts/service');
const commitsService = require('../services/cashouts/commits');
const { logPurchase } = require('../services/cashouts/logPurchase');

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

// GET /api/cashouts/providers — returns supported services available to the authenticated user
router.get('/providers', isAuthenticated, (req, res, next) => {
  try {
    const available = listAvailableCashouts();
    res.json(available);
  } catch (err) {
    next(err);
  }
});

// GET /api/cashouts/connections — list user's connections (never contains keys)
router.get('/connections', isAuthenticated, async (req, res, next) => {
  try {
    const connections = await listConnections(req.user.id);
    res.json(connections);
  } catch (err) {
    next(err);
  }
});

// POST /api/cashouts/connections — add connection (validates key with provider first)
router.post('/connections', isAuthenticated, validateBody(createCashoutConnection), async (req, res, next) => {
  try {
    const { provider, display_name, api_key, platform_id } = req.body;
    const connection = await createConnection(req.user.id, {
      provider,
      displayName: display_name,
      apiKey: api_key,
      platformId: platform_id,
    });
    res.status(201).json(connection);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /api/cashouts/connections/:id/test — test connection key
router.post('/connections/:id/test', isAuthenticated, async (req, res, next) => {
  try {
    const result = await testConnection(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// PATCH /api/cashouts/connections/:id — update connection
router.patch('/connections/:id', isAuthenticated, validateBody(updateCashoutConnection), async (req, res, next) => {
  try {
    const { display_name, api_key, platform_id } = req.body;
    const updated = await updateConnection(req.user.id, req.params.id, {
      displayName: display_name,
      apiKey: api_key,
      platformId: platform_id,
    });
    res.json(updated);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// DELETE /api/cashouts/connections/:id — remove connection
router.delete('/connections/:id', isAuthenticated, async (req, res, next) => {
  try {
    await deleteConnection(req.user.id, req.params.id);
    res.json({ success: true, message: 'Connection removed successfully.' });
  } catch (err) {
    res.status(err.status || 404).json({ error: err.message });
  }
});

// POST /api/cashouts/connections/:id/sync — manual "Sync now" with cooldown
router.post('/connections/:id/sync', isAuthenticated, async (req, res, next) => {
  try {
    const result = await syncUserConnection(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    if (err.cooldown) {
      return res.status(429).json({
        error: err.message,
        cooldown: true,
        remainingSeconds: err.remainingSeconds,
      });
    }
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/cashouts/deals — live deals from each connected cashout service
router.get('/deals', isAuthenticated, async (req, res, next) => {
  try {
    const connections = await listConnections(req.user.id);
    if (connections.length === 0) {
      return res.json({ connections: [], deals: [] });
    }

    const requestedConnId = req.query.connectionId;
    const targetConnections = requestedConnId
      ? connections.filter((c) => c.id === requestedConnId)
      : connections.filter((c) => c.status !== 'disconnected');

    const dealsByConnection = await Promise.all(
      targetConnections.map(async (conn) => {
        try {
          const fetchResult = await fetchConnectionDeals(req.user.id, conn.id);
          return {
            connection: conn,
            deals: fetchResult.deals,
            lastUpdated: fetchResult.lastUpdated,
            isStale: fetchResult.isStale,
            warning: fetchResult.warning || null,
          };
        } catch (err) {
          return {
            connection: conn,
            deals: [],
            lastUpdated: null,
            isStale: true,
            error: err.message,
          };
        }
      })
    );

    res.json({
      connections: targetConnections,
      results: dealsByConnection,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/cashouts/history — deal snapshot history
router.get('/history', isAuthenticated, async (req, res, next) => {
  try {
    const { dealId, provider, limit } = req.query;
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 100) : 50;
    const history = await getDealHistory(req.user.id, {
      externalDealId: dealId,
      provider,
      limit: parsedLimit,
    });
    res.json(history);
  } catch (err) {
    next(err);
  }
});

// GET /api/cashouts/commitments — local commitment records (read_commits' local mirror)
router.get('/commitments', isAuthenticated, async (req, res, next) => {
  try {
    const { connectionId, status } = req.query;
    const commitments = await commitsService.listLocalCommitments(req.user.id, { connectionId, status });
    res.json(commitments);
  } catch (err) {
    next(err);
  }
});

// GET /api/cashouts/connections/:id/commits — live commitments from the provider
router.get('/connections/:id/commits', isAuthenticated, async (req, res, next) => {
  try {
    const { limit, offset, search, dealStatus, dealId } = req.query;
    const result = await commitsService.listCommits(req.user.id, req.params.id, {
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
      search,
      dealStatus,
      dealId: dealId ? parseInt(dealId, 10) : undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code || null });
  }
});

// GET /api/cashouts/connections/:id/commits/:commitmentId — one live commitment
router.get('/connections/:id/commits/:commitmentId', isAuthenticated, async (req, res, next) => {
  try {
    const result = await commitsService.getCommit(req.user.id, req.params.id, req.params.commitmentId);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code || null });
  }
});

// POST /api/cashouts/connections/:id/commits — commit to a deal line item on its own
// (Log Purchase below does this plus tracking plus the purchase/sale records together.)
router.post('/connections/:id/commits', isAuthenticated, async (req, res, next) => {
  try {
    const { deal_id, item_id, quantity } = req.body;
    const commitment = await commitsService.createCommitment(req.user.id, req.params.id, {
      dealId: deal_id, itemId: item_id, quantity,
    });
    res.status(201).json(commitment);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message, code: err.code || null });
  }
});

// PATCH /api/cashouts/commitments/:id — change a commitment's quantity
router.patch('/commitments/:id', isAuthenticated, async (req, res, next) => {
  try {
    const commitment = await commitsService.updateCommitment(req.user.id, req.params.id, { quantity: req.body.quantity });
    res.json(commitment);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message, code: err.code || null });
  }
});

// DELETE /api/cashouts/commitments/:id — withdraw a commitment
router.delete('/commitments/:id', isAuthenticated, async (req, res, next) => {
  try {
    const commitment = await commitsService.deleteCommitment(req.user.id, req.params.id);
    res.json(commitment);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message, code: err.code || null });
  }
});

// POST /api/cashouts/connections/:id/tracking — submit tracking numbers on their own
router.post('/connections/:id/tracking', isAuthenticated, async (req, res, next) => {
  try {
    const { tracking_codes, description, insured_value } = req.body;
    const result = await commitsService.submitTracking(req.user.id, req.params.id, {
      trackingCodes: tracking_codes, description, insuredValue: insured_value,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message, code: err.code || null });
  }
});

// GET /api/cashouts/connections/:id/tracking — previously submitted tracking numbers
router.get('/connections/:id/tracking', isAuthenticated, async (req, res, next) => {
  try {
    const { limit, offset } = req.query;
    const result = await commitsService.listTrackingSubmissions(req.user.id, req.params.id, {
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code || null });
  }
});

// POST /api/cashouts/connections/:id/log-purchase — commit, submit tracking, and
// record the purchase + sale together. The real Log Purchase action.
router.post('/connections/:id/log-purchase', isAuthenticated, async (req, res, next) => {
  try {
    const b = req.body;
    const result = await logPurchase(req.user.id, {
      connectionId: req.params.id,
      dealId: b.deal_id,
      itemId: b.item_id,
      dealName: b.deal_name,
      itemName: b.item_name,
      quantity: b.quantity,
      trackingCodes: b.tracking_codes,
      insuredValue: b.insured_value,
      vendorId: b.vendor_id,
      paymentMethodId: b.payment_method_id,
      unitCost: b.unit_cost,
      taxExempt: b.tax_exempt,
      salesTax: b.sales_tax,
      cashbackRate: b.cashback_rate,
      cashbackEarned: b.cashback_earned,
      purchaseDate: b.purchase_date,
      unitPayout: b.unit_payout,
      saleDate: b.sale_date,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message, code: err.code || null });
  }
});

module.exports = router;
