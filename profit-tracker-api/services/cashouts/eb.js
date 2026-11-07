const BASE_URL = 'https://api.electronicsbuyer.gg';
const TIMEOUT_MS = 10000;

/**
 * ElectronicsBuyer (EB) Cashout Adapter
 */
const ebAdapter = {
  id: 'eb',
  name: 'ElectronicsBuyer',
  baseUrl: BASE_URL,

  /**
   * Test an API key with a live request without side effects.
   */
  async testKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error('API key is required.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(`${BASE_URL}/v1/api/deals?limit=1`, {
        method: 'GET',
        headers: {
          'X-API-Key': apiKey.trim(),
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        const err = new Error('ElectronicsBuyer rejected the API key (unauthorized or missing read_deals permission).');
        err.keyRejected = true;
        throw err;
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        throw new Error(`ElectronicsBuyer rate limit exceeded. Retry after ${retryAfter || '60'} seconds.`);
      }

      if (!response.ok) {
        throw new Error(`ElectronicsBuyer returned HTTP ${response.status} during key verification.`);
      }

      const data = await response.json();
      if (!data || !Array.isArray(data.data)) {
        throw new Error('ElectronicsBuyer returned an unexpected response structure.');
      }

      return { success: true };
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Connection to ElectronicsBuyer timed out.');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  },

  /**
   * Fetch live deals from EB and normalize into common cashout deal structure.
   */
  async fetchDeals(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error('API key is required.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(`${BASE_URL}/v1/api/deals?limit=100`, {
        method: 'GET',
        headers: {
          'X-API-Key': apiKey.trim(),
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        const err = new Error('ElectronicsBuyer API key is invalid or revoked.');
        err.keyRejected = true;
        throw err;
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const err = new Error(`ElectronicsBuyer rate limit exceeded. Retry after ${retryAfter || '60'}s.`);
        err.rateLimited = true;
        err.retryAfter = parseInt(retryAfter, 10) || 60;
        throw err;
      }

      if (!response.ok) {
        throw new Error(`ElectronicsBuyer returned HTTP ${response.status}.`);
      }

      const body = await response.json();
      const rawDeals = Array.isArray(body?.data) ? body.data : [];

      return rawDeals.map((deal) => {
        const items = Array.isArray(deal.items) ? deal.items : [];
        return {
          id: String(deal.id),
          provider: 'eb',
          name: deal.name || 'Untitled Deal',
          imageUrl: deal.image_url || null,
          retail: typeof deal.retail === 'number' ? deal.retail : (parseFloat(deal.retail) || null),
          payout: typeof deal.payout === 'number' ? deal.payout : (parseFloat(deal.payout) || 0),
          profitMargin: typeof deal.profit_margin === 'number' ? deal.profit_margin : (parseFloat(deal.profit_margin) || 0),
          productLinks: Array.isArray(deal.product_links) ? deal.product_links : [],
          categoryId: deal.category_id ? String(deal.category_id) : null,
          expiresAt: deal.expires_at ? new Date(deal.expires_at * 1000).toISOString() : null,
          startsAt: deal.starts_at ? new Date(deal.starts_at * 1000).toISOString() : null,
          featured: Boolean(deal.featured),
          notes: deal.notes || null,
          status: deal.status || 'active',
          onSaleNow: typeof deal.on_sale_now === 'boolean' ? deal.on_sale_now : null,
          createdAt: deal.created_at ? new Date(deal.created_at * 1000).toISOString() : null,
          avgRemainingPercentage: deal.avg_remaining_percentage ?? null,
          items: items.map((item) => ({
            id: String(item.id),
            name: item.name || deal.name || 'Default Item',
            condition: item.condition || 'new',
            upcs: Array.isArray(item.upcs) ? item.upcs.map(String) : [],
            purchaseLinks: Array.isArray(item.purchase_links) ? item.purchase_links : [],
            vendorLimit: item.vendor_limit ?? null,
            remainingPercentage: item.remaining_percentage ?? null,
          })),
        };
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Request to ElectronicsBuyer timed out.');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  },
};

module.exports = ebAdapter;
