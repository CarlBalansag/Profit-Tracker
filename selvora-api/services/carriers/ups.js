// UPS Track API — OAuth client-credentials flow.
// Docs: https://developer.ups.com/api/reference/oauth/client-credentials
//       https://developer.ups.com/api/reference/tracking

const TOKEN_URL = 'https://onlinetools.ups.com/security/v1/oauth/token';
const TRACK_URL = 'https://onlinetools.ups.com/api/track/v1/details';

let cachedToken = null; // { token, expiresAt }

function isConfigured() {
  return Boolean(process.env.UPS_CLIENT_ID && process.env.UPS_CLIENT_SECRET);
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;

  const credentials = Buffer.from(`${process.env.UPS_CLIENT_ID}:${process.env.UPS_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });
  if (!res.ok) throw Object.assign(new Error('UPS OAuth token request failed'), { status: res.status });
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return cachedToken.token;
}

// Maps a UPS activity's status description into our short normalized status string.
function normalizeStatus(description = '') {
  const d = description.toLowerCase();
  if (d.includes('delivered')) return 'Delivered';
  if (d.includes('out for delivery')) return 'Out for Delivery';
  if (d.includes('exception') || d.includes('delay')) return 'Exception';
  if (d.includes('pickup') || d.includes('order processed') || d.includes('label')) return 'Pre-Transit';
  if (d) return 'In Transit';
  return 'Unknown';
}

function activityTimestamp(activity) {
  const date = activity.date; // YYYYMMDD
  const time = activity.time || '000000'; // HHMMSS
  if (!date) return null;
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function activityLocation(activity) {
  const addr = activity.location?.address;
  if (!addr) return null;
  return [addr.city, addr.stateProvince, addr.country].filter(Boolean).join(', ') || null;
}

// UPS package-level dates use plain YYYYMMDD (no time component).
function packageDateIso(dateStr) {
  if (!dateStr || dateStr.length < 8) return null;
  const iso = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}T12:00:00`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function trackByNumber(trackingNumber) {
  const token = await getAccessToken();
  const res = await fetch(`${TRACK_URL}/${encodeURIComponent(trackingNumber)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      transId: `selvora-${Date.now()}`,
      transactionSrc: 'selvora',
    },
  });
  if (!res.ok) throw Object.assign(new Error('UPS tracking request failed'), { status: res.status });
  const data = await res.json();

  const pkg = data?.trackResponse?.shipment?.[0]?.package?.[0];
  const activities = pkg?.activity || [];
  const events = activities
    .map(a => ({ date: activityTimestamp(a), description: a.status?.description || 'Update', location: activityLocation(a) }))
    .filter(e => e.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const deliveredEvent = events.find(e => e.description.toLowerCase().includes('delivered'));
  // "SDD" = Scheduled Delivery Date — UPS's estimated-arrival field for
  // packages still in transit.
  const estimatedDelivery = packageDateIso(pkg?.deliveryDate?.find(d => d.type === 'SDD')?.date);

  return {
    status: normalizeStatus(events[0]?.description),
    events,
    deliveredAt: deliveredEvent?.date || null,
    estimatedDelivery,
  };
}

module.exports = { isConfigured, trackByNumber };
