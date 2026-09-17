// FedEx Track API — OAuth client-credentials flow.
// Docs: https://developer.fedex.com/api/en-us/catalog/authorization.html
//       https://developer.fedex.com/api/en-us/catalog/track.html

const TOKEN_URL = 'https://apis.fedex.com/oauth/token';
const TRACK_URL = 'https://apis.fedex.com/track/v1/trackingnumbers';

let cachedToken = null; // { token, expiresAt }

function isConfigured() {
  return Boolean(process.env.FEDEX_CLIENT_ID && process.env.FEDEX_CLIENT_SECRET);
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.FEDEX_CLIENT_ID,
      client_secret: process.env.FEDEX_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw Object.assign(new Error('FedEx OAuth token request failed'), { status: res.status });
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return cachedToken.token;
}

function normalizeStatus(description = '') {
  const d = description.toLowerCase();
  if (d.includes('delivered')) return 'Delivered';
  if (d.includes('out for delivery')) return 'Out for Delivery';
  if (d.includes('exception') || d.includes('delay')) return 'Exception';
  if (d.includes('label') || d.includes('shipment information sent')) return 'Pre-Transit';
  if (d) return 'In Transit';
  return 'Unknown';
}

function eventLocation(event) {
  const loc = event.scanLocation;
  if (!loc) return null;
  return [loc.city, loc.stateOrProvinceCode, loc.countryCode].filter(Boolean).join(', ') || null;
}

async function trackByNumber(trackingNumber) {
  const token = await getAccessToken();
  const res = await fetch(TRACK_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-locale': 'en_US',
    },
    body: JSON.stringify({
      trackingInfo: [{ trackingNumberInfo: { trackingNumber } }],
      includeDetailedScans: true,
    }),
  });
  if (!res.ok) throw Object.assign(new Error('FedEx tracking request failed'), { status: res.status });
  const data = await res.json();

  const trackResult = data?.output?.completeTrackResults?.[0]?.trackResults?.[0];
  const scanEvents = trackResult?.scanEvents || [];
  const events = scanEvents
    .map(e => ({ date: e.date ? new Date(e.date).toISOString() : null, description: e.eventDescription || 'Update', location: eventLocation(e) }))
    .filter(e => e.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const actualDelivery = trackResult?.dateAndTimes?.find(d => d.type === 'ACTUAL_DELIVERY')?.dateTime;
  const latestDescription = trackResult?.latestStatusDetail?.description || events[0]?.description;

  return {
    status: normalizeStatus(latestDescription),
    events,
    deliveredAt: actualDelivery ? new Date(actualDelivery).toISOString() : null,
  };
}

module.exports = { isConfigured, trackByNumber };
