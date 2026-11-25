// Card artwork resolver.
//
// Order for one card:
//   1. the catalog's own artwork for the card (issuer image);
//   2. other artwork the catalog has for it: the catalog's mirror of the same
//      image, then the linked older preset's card when it is clearly the same
//      product (its name matches the saved card's);
//   3. a custom design in the issuer's colours;
//   4. a plain design for the payment network, when the issuer is unknown.
//
// Issuer images come in every shape: flat card faces, faces floating in empty
// space, portrait faces, tilted 3D renders, even marketing photos. Each one is
// measured once (`measureArtwork`) so a face can be framed exactly, and images
// that aren't a card face are skipped instead of being squashed into one.
import { LEGACY_PRESET_TO_CATALOG } from './cardRewards';

// ISO/IEC 7810 ID-1, the size of every bank card: 85.60 x 53.98 mm.
export const CARD_RATIO = 85.6 / 53.98;

// ─── Picking candidates ───────────────────────────────────────────────────────
const STOP = new Set(['card', 'credit', 'the', 'from', 'by', 'and', 'rewards', 'visa', 'mastercard', 'signature', 'world', 'elite', 'american', 'express', 'bank', 'of', 'america', 'chase', 'citi', 'capital', 'one', 'discover', 'prime']);
const words = (s) => new Set(String(s || '').toLowerCase().replace(/[®™℠]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w && !STOP.has(w)));

// The other card's name has every distinctive word of the saved name
// ("Amazon Store Card" / "Amazon Prime Store Card").
export function sameProduct(savedName, catalogName) {
  const a = words(savedName);
  const b = words(catalogName);
  return a.size > 0 && [...a].every((w) => b.has(w));
}

// Pictures that pass the shape check but show several cards.
const NOT_ONE_CARD = new Set(['us-discover-it-student-cash-back']);

const defaultArtUrl = (id, source) => `${import.meta.env.VITE_API_URL || ''}/api/card-catalog/${id}/art/${source}`;

// Catalog cards whose artwork this card might use.
export const artCatalogIds = (methods) => [...new Set((methods || []).filter((m) => m.type === 'Credit').flatMap((m) => [m.catalog_card_id, LEGACY_PRESET_TO_CATALOG[m.preset_card_id]]).filter(Boolean))].sort();

export function artworkCandidates(card, catalogById, artUrl = defaultArtUrl) {
  const out = [];
  const add = (catalogCard, tier) => {
    if (!catalogCard?.art || NOT_ONE_CARD.has(catalogCard.id)) return;
    if (catalogCard.art.primary) out.push({ tier, catalogId: catalogCard.id, src: artUrl(catalogCard.id, 'primary') });
    if (catalogCard.art.mirror) out.push({ tier: 'alternate', catalogId: catalogCard.id, src: artUrl(catalogCard.id, 'mirror') });
  };
  add(catalogById.get(card.catalogId), 'artwork');
  const presetId = LEGACY_PRESET_TO_CATALOG[card.presetId];
  if (presetId && presetId !== card.catalogId) {
    const alternate = catalogById.get(presetId);
    if (alternate && sameProduct(card.name, alternate.name)) add(alternate, 'alternate');
  }
  return out;
}

// ─── Measuring an image ───────────────────────────────────────────────────────
const SOLID_ALPHA = 200; // below this is a drop shadow or empty space
const COVERAGE = 0.55; // a row or column belongs to the card face when most of it is solid
const MAX_SPILL = 0.06; // a ribbon may hang off a card; more than this is a tilted card or several
const isLandscapeCard = (r) => r >= 1.48 && r <= 1.67;
const isPortraitCard = (r) => r >= 0.595 && r <= 0.68;
// A card drawn at an angle: not an exact card shape, but a single solid one.
const isAngledCard = (r) => (r >= 1.2 && r <= 1.75) || (r >= 0.48 && r <= 0.75);

const span = (counts) => {
  const peak = Math.max(...counts);
  let from = 0;
  let to = counts.length - 1;
  while (from < to && counts[from] < peak * COVERAGE) from += 1;
  while (to > from && counts[to] < peak * COVERAGE) to -= 1;
  return [from, to];
};

// The card face inside a picture: rows and columns are judged against each
// other three times, so empty space, shadows and small stickers that hang off
// the card don't count.
function findFace({ data, width, height }, solid) {
  let box = { x0: 0, x1: width - 1, y0: 0, y1: height - 1 };
  for (let pass = 0; pass < 3; pass += 1) {
    const rows = new Array(height).fill(0);
    const cols = new Array(width).fill(0);
    let any = false;
    for (let y = box.y0; y <= box.y1; y += 1) {
      for (let x = box.x0; x <= box.x1; x += 1) {
        if (!solid(y * width + x)) continue;
        any = true;
        rows[y] += 1;
        cols[x] += 1;
      }
    }
    if (!any) return null;
    const [y0, y1] = span(rows);
    const [x0, x1] = span(cols);
    box = { x0, x1, y0, y1 };
  }
  const w = box.x1 - box.x0 + 1;
  const h = box.y1 - box.y0 + 1;
  let filled = 0;
  let everything = 0;
  for (let i = 0; i < width * height; i += 1) if (solid(i)) everything += 1;
  const sum = [0, 0, 0];
  for (let y = box.y0; y <= box.y1; y += 1) {
    for (let x = box.x0; x <= box.x1; x += 1) {
      const i = y * width + x;
      if (!solid(i)) continue;
      filled += 1;
      for (let k = 0; k < 3; k += 1) sum[k] += data[i * 4 + k];
    }
  }
  return {
    box: { x: box.x0 / width, y: box.y0 / height, w: w / width, h: h / height },
    ratio: w / h,
    fill: filled / (w * h),
    spill: (everything - filled) / Math.max(1, filled),
    area: (w * h) / (width * height),
    tint: sum.map((v) => Math.round(v / Math.max(1, filled))),
  };
}

// RGBA picture -> where the card face is (fractions of the picture), what kind
// of picture it is, and its average colour.
export function measureArtwork(picture) {
  const { data, width, height } = picture;
  const total = width * height;
  let clear = 0;
  for (let i = 0; i < total; i += 1) if (data[i * 4 + 3] < SOLID_ALPHA) clear += 1;
  const transparent = clear > total * 0.002;

  // Opaque picture: one flat colour shared by all four corners is the page.
  const rgb = (i) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
  const near = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 24;
  const corner = rgb(0);
  const flatPage = !transparent && [width - 1, (height - 1) * width, total - 1].every((i) => near(rgb(i), corner));
  const solid = (i) => {
    if (transparent) return data[i * 4 + 3] >= SOLID_ALPHA;
    return flatPage ? !near(rgb(i), corner) : true;
  };

  const trimmed = findFace(picture, solid);
  const whole = findFace(picture, () => true);
  const result = (f, kind) => ({
    kind,
    ratio: f.ratio,
    fill: f.fill,
    spill: f.spill,
    box: f.box,
    tint: f.tint,
    light: 0.299 * f.tint[0] + 0.587 * f.tint[1] + 0.114 * f.tint[2] > 150,
  });
  const single = trimmed && trimmed.spill <= MAX_SPILL;
  if (single && trimmed.fill >= 0.93) {
    if (isLandscapeCard(trimmed.ratio)) return result(trimmed, 'landscape');
    if (isPortraitCard(trimmed.ratio)) return result(trimmed, 'portrait');
  }
  // A card whose edges match the page colour (a white card, or one flat
  // colour): the trim can't find them, but the picture itself is card shaped.
  if (!transparent && isLandscapeCard(whole.ratio) && (!trimmed || trimmed.area > 0.5)) return result(whole, 'landscape');
  if (transparent && single && trimmed.fill >= 0.93 && isAngledCard(trimmed.ratio)) return result(trimmed, 'angled');
  return result(trimmed || whole, 'scene');
}

export const isUsableArt = (meta) => Boolean(meta) && meta.kind !== 'scene';

// How to place the measured face inside a card frame, as CSS percentages of
// the frame. A face within 2.5% of the real card shape fills the frame; any
// other shape is shown whole, centred, at its own proportions.
export const FILL_TOLERANCE = 0.025;
export function placeArtwork(meta, imageRatio, frameRatio = CARD_RATIO) {
  const faceRatio = imageRatio * (meta.box.w / meta.box.h);
  const fills = meta.kind === 'landscape' && Math.abs(faceRatio / frameRatio - 1) <= FILL_TOLERANCE;
  // In units of frame width: the frame is 1 wide and 1/frameRatio tall.
  const frameH = 1 / frameRatio;
  const faceW = fills
    ? Math.max(1, frameH * faceRatio) * 1.016 // a hair over, so a worn or sloped edge never shows
    : Math.min(1, frameH * faceRatio) * (meta.kind === 'landscape' ? 1 : 0.92);
  const faceH = faceW / faceRatio;
  const imgW = faceW / meta.box.w;
  const imgH = faceH / meta.box.h;
  const pct = (v) => `${Math.round(v * 10000) / 100}%`;
  return {
    fills,
    width: pct(imgW),
    left: pct((1 - faceW) / 2 - meta.box.x * imgW),
    top: pct(((frameH - faceH) / 2 - meta.box.y * imgH) / frameH),
    // Cuts away everything around the face: page colour, shadows, stickers.
    clip: `inset(${[meta.box.y, 1 - meta.box.x - meta.box.w, 1 - meta.box.y - meta.box.h, meta.box.x].map((v) => pct(Math.max(0, v))).join(' ')} round ${pct(0.04)})`,
  };
}

// ─── Loading ──────────────────────────────────────────────────────────────────
const MEASURE_WIDTH = 240;

function measureImage(img, imageRatio) {
  const width = Math.min(MEASURE_WIDTH, img.naturalWidth);
  const height = Math.max(1, Math.round(width / imageRatio));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, width, height);
    return measureArtwork(ctx.getImageData(0, 0, width, height));
  } catch {
    // The image host doesn't allow reading pixels: still usable when the
    // picture itself is card shaped.
    const kind = isLandscapeCard(imageRatio) ? 'landscape' : isPortraitCard(imageRatio) ? 'portrait' : 'scene';
    return { kind, ratio: imageRatio, fill: 1, tint: [40, 44, 52], light: false, box: { x: 0, y: 0, w: 1, h: 1 } };
  }
}

// One load and one measurement per image, shared by every copy on the page.
const loaded = new Map();
export function loadArtwork(src) {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      // Only matters in development, where the API is on another address: the
      // picture can then be measured and the sign-in cookie is sent.
      img.crossOrigin = 'use-credentials';
      img.onload = () => {
        const imageRatio = img.naturalWidth / img.naturalHeight;
        resolve({ src, imageRatio, pixels: img.naturalWidth, meta: measureImage(img, imageRatio) });
      };
      img.onerror = () => { loaded.delete(src); reject(new Error(`Could not load ${src}`)); };
      img.src = src;
    }));
  }
  return loaded.get(src);
}

// The first candidate that loads and really is a card face, or null.
export async function resolveArtwork(candidates, load = loadArtwork) {
  for (const candidate of candidates) {
    try {
      const art = await load(candidate.src);
      if (isUsableArt(art.meta)) return { ...candidate, ...art };
    } catch { /* try the next one */ }
  }
  return null;
}
