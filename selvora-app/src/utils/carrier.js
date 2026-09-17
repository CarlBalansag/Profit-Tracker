// Carrier detection from tracking number format.
// Kept in sync with the backend copy in selvora-api/services/tracking.js,
// which is the source of truth for which carrier's API gets called.
export function detectCarrier(trackingNumber) {
  if (!trackingNumber) return null;
  const tn = trackingNumber.trim();
  // Amazon — TBA prefix
  if (/^TBA[0-9]+$/i.test(tn)) return { label: 'Amazon', color: 'bg-orange-500/10 text-orange-400 border-orange-500/20' };
  // UPS — starts with 1Z, 18 chars total
  if (/^1Z[0-9A-Z]{16}$/i.test(tn)) return { label: 'UPS', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' };
  // USPS — 94/93/92/95 prefix (20-22 digits), or international format (e.g. EA123456789US).
  // Checked before FedEx's generic digit-count rule below, since e.g. a 22-digit
  // "94..." number would otherwise also match FedEx's bare 22-digit pattern.
  if (/^(94|93|92|95)[0-9]{18,20}$/.test(tn)) return { label: 'USPS', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' };
  if (/^(70|14|23|03)[0-9]{14}$/.test(tn)) return { label: 'USPS', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' };
  if (/^[A-Z]{2}[0-9]{9}[A-Z]{2}$/.test(tn)) return { label: 'USPS', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' };
  // FedEx — 12, 15, 20, or 22 digits
  if (/^[0-9]{12}$/.test(tn) || /^[0-9]{15}$/.test(tn) || /^[0-9]{20}$/.test(tn) || /^[0-9]{22}$/.test(tn)) return { label: 'FedEx', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' };
  // DHL — JD prefix (eCommerce), or 10-digit number
  if (/^JD[0-9A-Z]+$/i.test(tn)) return { label: 'DHL', color: 'bg-red-500/10 text-red-400 border-red-500/20' };
  if (/^[0-9]{10}$/.test(tn)) return { label: 'DHL', color: 'bg-red-500/10 text-red-400 border-red-500/20' };
  // ONTRAC — C prefix + 14 digits
  if (/^C[0-9]{14}$/.test(tn)) return { label: 'OnTrac', color: 'bg-green-500/10 text-green-400 border-green-500/20' };
  // Generic fallback — show a neutral chip with a truncated number
  return { label: 'Track', color: 'bg-white/5 text-gray-400 border-white/10' };
}

// Public tracking-page URL for carriers we don't call an API for (or when the
// live API call comes back not_configured/restricted). Returns null if the
// carrier has no known public tracking URL (e.g. Amazon).
export function carrierTrackingUrl(carrierLabel, trackingNumber) {
  if (!carrierLabel || !trackingNumber) return null;
  const tn = encodeURIComponent(trackingNumber);
  switch (carrierLabel) {
    case 'UPS': return `https://www.ups.com/track?tracknum=${tn}`;
    case 'FedEx': return `https://www.fedex.com/fedextrack/?trknbr=${tn}`;
    case 'USPS': return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${tn}`;
    case 'DHL': return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${tn}`;
    case 'OnTrac': return `https://www.ontrac.com/tracking/?tracking_number=${tn}`;
    default: return null;
  }
}
