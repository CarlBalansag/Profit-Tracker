const BASE_URL = 'https://api.electronicsbuyer.gg';
const TIMEOUT_MS = 10000;

// Shared request helper for the commits/tracking endpoints added after
// testKey/fetchDeals -- those two keep their own inline fetch rather than
// being rewritten onto this, so a bug here can't touch deal-browsing at all.
//
// EB's error body is always { error: true, code, message } (confirmed from
// /docs/authentication's 401/403 examples). A 401 means the key itself is
// bad. A 403 is different -- EB's own docs say a *valid* key can still lack
// one specific permission (e.g. write_commits) -- so that's surfaced as
// `permissionDenied`, not `keyRejected`: the fix is enabling a checkbox on
// EB's dashboard, not re-entering the key.
async function request(apiKey, method, path, body, permissionHint) {
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error('API key is required.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'X-API-Key': apiKey.trim(),
        'Accept': 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (response.status === 204) return null;

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (response.status === 401) {
      const err = new Error(payload?.message || 'ElectronicsBuyer API key is invalid or revoked.');
      err.keyRejected = true;
      err.code = payload?.code || 'INVALID_AUTHORIZATION_KEY';
      throw err;
    }

    if (response.status === 403) {
      const err = new Error(
        payload?.message
        || `ElectronicsBuyer rejected this request${permissionHint ? ` -- your key may be missing the ${permissionHint} permission` : ''}. Check Settings > API Integration on your ElectronicsBuyer dashboard.`,
      );
      err.permissionDenied = true;
      err.code = payload?.code || 'FORBIDDEN';
      throw err;
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const err = new Error(payload?.message || `ElectronicsBuyer rate limit exceeded. Retry after ${retryAfter || '60'}s.`);
      err.rateLimited = true;
      err.retryAfter = parseInt(retryAfter, 10) || 60;
      err.code = payload?.code || 'RATE_LIMIT_EXCEEDED';
      throw err;
    }

    if (!response.ok) {
      const err = new Error(payload?.message || `ElectronicsBuyer returned HTTP ${response.status}.`);
      err.status = response.status;
      err.code = payload?.code || null;
      throw err;
    }

    return payload;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Request to ElectronicsBuyer timed out.');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

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

  /**
   * List your commitments. Requires read_commits.
   */
  async listCommits(apiKey, { limit, offset, search, dealStatus, dealId } = {}) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (offset) params.set('offset', String(offset));
    if (search) params.set('search', search);
    if (dealStatus) params.set('deal_status', dealStatus);
    if (dealId) params.set('deal_id', String(dealId));
    const query = params.toString();
    return request(apiKey, 'GET', `/v1/api/commits${query ? `?${query}` : ''}`, undefined, 'read_commits');
  },

  /**
   * Get one commitment by its EB id. Requires read_commits.
   */
  async getCommit(apiKey, commitmentId) {
    return request(apiKey, 'GET', `/v1/api/commits/${encodeURIComponent(commitmentId)}`, undefined, 'read_commits');
  },

  /**
   * Pledge units to a deal line item -- the financially binding step.
   * Requires write_commits. One commitment per item_id; a second attempt
   * returns 400 INVALID_OPERATION (surfaced as err.code), not a new row.
   */
  async createCommit(apiKey, { itemId, quantity }) {
    return request(apiKey, 'POST', '/v1/api/commits', { item_id: itemId, quantity }, 'write_commits');
  },

  /**
   * Change an existing commitment's quantity. Requires write_commits.
   */
  async updateCommit(apiKey, commitmentId, { quantity }) {
    return request(apiKey, 'PATCH', `/v1/api/commits/${encodeURIComponent(commitmentId)}`, { quantity }, 'write_commits');
  },

  /**
   * Withdraw a commitment, freeing its quantity back to the deal immediately.
   * Requires write_commits. Returns null (204 No Content) on success.
   */
  async deleteCommit(apiKey, commitmentId) {
    return request(apiKey, 'DELETE', `/v1/api/commits/${encodeURIComponent(commitmentId)}`, undefined, 'write_commits');
  },

  /**
   * Submit inbound tracking numbers. Requires write_tracking_submissions.
   * EB has no field linking these to a specific commitment -- description is
   * free text only, never parsed back out by EB. Our own CashoutCommitment
   * row is the only place that link is actually kept.
   */
  async submitTracking(apiKey, { trackingCodes, description, insuredValue }) {
    return request(apiKey, 'POST', '/v1/api/tracking', {
      tracking_codes: trackingCodes,
      description,
      ...(insuredValue !== undefined && insuredValue !== null ? { insured_value: insuredValue } : {}),
    }, 'write_tracking_submissions');
  },

  /**
   * List previously submitted tracking numbers. Requires read_tracking_submissions.
   */
  async listTrackingSubmissions(apiKey, { limit, offset } = {}) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (offset) params.set('offset', String(offset));
    const query = params.toString();
    return request(apiKey, 'GET', `/v1/api/tracking${query ? `?${query}` : ''}`, undefined, 'read_tracking_submissions');
  },
};

module.exports = ebAdapter;
