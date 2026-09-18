// USPS Tracking API — OAuth client-credentials flow.
// Docs: https://developers.usps.com/getting-started
//
// As of April 2026 USPS restricts third-party access: a tracking number is only
// freely trackable if it was generated under the caller's own Mailer ID. A 401/403
// here means the number belongs to someone else's Mailer ID — callers should treat
// that as `restricted`, not a hard failure.

const TOKEN_URL = 'https://apis.usps.com/oauth2/v3/token';
const TRACK_URL = 'https://apis.usps.com/tracking/v3/tracking';

let cachedToken = null; // { token, expiresAt }

function isConfigured() {
  return Boolean(process.env.USPS_CLIENT_ID && process.env.USPS_CLIENT_SECRET);
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.USPS_CLIENT_ID,
      client_secret: process.env.USPS_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw Object.assign(new Error('USPS OAuth token request failed'), { status: res.status });
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return cachedToken.token;
}

function normalizeStatus(category = '') {
  const c = category.toLowerCase();
  if (c.includes('delivered')) return 'Delivered';
  if (c.includes('out for delivery')) return 'Out for Delivery';
  if (c.includes('alert') || c.includes('exception')) return 'Exception';
  if (c.includes('accept') || c.includes('pre-shipment')) return 'Pre-Transit';
  if (c) return 'In Transit';
  return 'Unknown';
}

function eventLocation(event) {
  return [event.eventCity, event.eventState].filter(Boolean).join(', ') || null;
}

async function trackByNumber(trackingNumber) {
  const token = await getAccessToken();
  const res = await fetch(`${TRACK_URL}/${encodeURIComponent(trackingNumber)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error('USPS tracking access restricted for this number'), { restricted: true, status: res.status });
  }
  if (!res.ok) throw Object.assign(new Error('USPS tracking request failed'), { status: res.status });

  const data = await res.json();
  const trackingEvents = data.trackingEvents || [];
  const events = trackingEvents
    .map(e => ({ date: e.eventTimestamp ? new Date(e.eventTimestamp).toISOString() : null, description: e.eventType || 'Update', location: eventLocation(e) }))
    .filter(e => e.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const status = normalizeStatus(data.statusCategory || data.status);
  const deliveredAt = status === 'Delivered' ? (events[0]?.date || null) : null;
  const estimatedDeliveryRaw = data.expectedDeliveryDate || data.expectedDeliveryTimestamp || null;
  const estimatedDelivery = estimatedDeliveryRaw ? new Date(estimatedDeliveryRaw).toISOString() : null;

  return { status, events, deliveredAt, estimatedDelivery };
}

module.exports = { isConfigured, trackByNumber };
