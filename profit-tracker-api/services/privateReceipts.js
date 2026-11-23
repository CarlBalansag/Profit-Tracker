// Private receipts. New receipt uploads are stored in Cloudinary as
// "authenticated" assets, which can't be opened from a plain URL. The
// database keeps a reference instead of a link:
//   private:<resource_type>:<format>:<public_id>
// and every response that shows a receipt to its signed-in owner swaps it for
// a signed download link that expires after a few minutes.
//
// A reference is only ever signed for the item it was uploaded to: the upload
// names the file `<itemType>_<itemId>_<uuid>`, and the name is checked here,
// so a reference copied onto another record (expenses accept a client-sent
// receipt_url) can't open someone else's file. Older receipts keep their
// public https links and are returned unchanged.
const cloudinary = require('cloudinary').v2;

const PREFIX = 'private:';
const FOLDER = 'profittracker/receipts/';
const LINK_SECONDS = 10 * 60;

const privateRef = ({ resourceType, format, publicId }) => `${PREFIX}${resourceType || 'image'}:${format || ''}:${publicId}`;

function parsePrivateRef(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return null;
  const match = value.slice(PREFIX.length).match(/^(image|raw|video):([a-z0-9]*):(.+)$/);
  if (!match) return null;
  return { resourceType: match[1], format: match[2], publicId: match[3] };
}

const isPrivateRef = (value) => typeof value === 'string' && value.startsWith(PREFIX);

// The file was uploaded for exactly this item.
function belongsTo(ref, itemType, itemId) {
  if (!ref || !ref.publicId.startsWith(FOLDER)) return false;
  const name = ref.publicId.slice(FOLDER.length);
  return name.startsWith(`${itemType}_${itemId}_`) && !name.slice(`${itemType}_${itemId}_`.length).includes('/');
}

/**
 * What to show for a stored receipt_url: a public link as-is, a short-lived
 * signed link for a private receipt of this item, or null if it can't be
 * signed (wrong item, or Cloudinary isn't configured).
 */
function receiptLink(value, itemType, itemId, now = Date.now()) {
  if (!value) return null;
  if (!isPrivateRef(value)) return value;
  const ref = parsePrivateRef(value);
  if (!belongsTo(ref, itemType, itemId)) return null;
  try {
    return cloudinary.utils.private_download_url(ref.publicId, ref.format, {
      resource_type: ref.resourceType, type: 'authenticated', expires_at: Math.floor(now / 1000) + LINK_SECONDS,
    });
  } catch {
    return null;
  }
}

/** A copy of a row with its receipt_url ready to show, plus receipt_private. */
function withReceiptLink(row, itemType, idField = 'id') {
  if (!row || !('receipt_url' in row)) return row;
  const priv = isPrivateRef(row.receipt_url);
  return { ...row, receipt_url: receiptLink(row.receipt_url, itemType, row[idField]), receipt_private: priv };
}

module.exports = { privateRef, parsePrivateRef, isPrivateRef, belongsTo, receiptLink, withReceiptLink, LINK_SECONDS, FOLDER };
