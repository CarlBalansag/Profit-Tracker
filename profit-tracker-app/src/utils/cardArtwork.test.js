import { describe, expect, it } from 'vitest';
import { CARD_RATIO, artCatalogIds, artworkCandidates, isUsableArt, measureArtwork, placeArtwork, resolveArtwork, sameProduct } from './cardArtwork';

// A width x height picture; paint(x, y) -> [r, g, b, a]
const picture = (width, height, paint) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data.set(paint(x, y), (y * width + x) * 4);
  return { data, width, height };
};
const BLUE = [20, 60, 140, 255];
const CLEAR = [0, 0, 0, 0];
const WHITE = [255, 255, 255, 255];
const inside = (x, y, x0, y0, w, h) => x >= x0 && x < x0 + w && y >= y0 && y < y0 + h;

describe('measureArtwork', () => {
  it('reads a full-bleed card as a landscape face covering the picture', () => {
    const m = measureArtwork(picture(158, 100, () => BLUE));
    expect(m.kind).toBe('landscape');
    expect(m.box).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(m.tint).toEqual([20, 60, 140]);
    expect(m.light).toBe(false);
  });
  it('trims empty space and drop shadows around a floating card', () => {
    const m = measureArtwork(picture(240, 160, (x, y) => (inside(x, y, 41, 30, 158, 100) ? BLUE : inside(x, y, 41, 130, 158, 12) ? [0, 0, 0, 90] : CLEAR)));
    expect(m.kind).toBe('landscape');
    expect(m.box.x).toBeCloseTo(41 / 240, 2);
    expect(m.box.h).toBeCloseTo(100 / 160, 2);
  });
  it('trims a white page around a card, including a portrait one', () => {
    expect(measureArtwork(picture(240, 240, (x, y) => (inside(x, y, 20, 60, 200, 126) ? BLUE : WHITE))).kind).toBe('landscape');
    expect(measureArtwork(picture(240, 152, (x, y) => (inside(x, y, 75, 4, 90, 144) ? BLUE : WHITE))).kind).toBe('portrait');
  });
  it('ignores a marketing ribbon that hangs off the edge', () => {
    const m = measureArtwork(picture(200, 126, (x, y) => (inside(x, y, 0, 6, 190, 120) || inside(x, y, 150, 0, 50, 30) ? BLUE : CLEAR)));
    expect(m.kind).toBe('landscape');
    expect(m.box.w).toBeCloseTo(190 / 200, 2);
    expect(m.box.y).toBeCloseTo(6 / 126, 2);
  });
  it('rejects a tilted card and a group of cards', () => {
    // A 100x63 card turned 20 degrees.
    const a = Math.PI / 9;
    const tilted = picture(160, 160, (x, y) => {
      const dx = x - 80; const dy = y - 80;
      return Math.abs(dx * Math.cos(a) + dy * Math.sin(a)) < 50 && Math.abs(dy * Math.cos(a) - dx * Math.sin(a)) < 31.5 ? BLUE : CLEAR;
    });
    expect(isUsableArt(measureArtwork(tilted))).toBe(false);
    expect(isUsableArt(measureArtwork(picture(200, 140, (x, y) => (inside(x, y, 0, 40, 140, 88) || inside(x, y, 60, 4, 140, 88) ? BLUE : CLEAR))))).toBe(false);
  });
  it('rejects photos, odd shapes and an empty picture', () => {
    let seed = 1;
    const noise = () => { seed = (seed * 16807) % 2147483647; return seed % 255; };
    expect(isUsableArt(measureArtwork(picture(178, 100, () => [noise(), noise(), noise(), 255])))).toBe(false);
    expect(isUsableArt(measureArtwork(picture(100, 100, () => CLEAR)))).toBe(false);
    expect(isUsableArt(null)).toBe(false);
  });
});

describe('placeArtwork', () => {
  const full = { kind: 'landscape', box: { x: 0, y: 0, w: 1, h: 1 } };
  it('fills the frame when the shape matches', () => {
    expect(placeArtwork(full, CARD_RATIO).fills).toBe(true);
  });
  it('shows any other shape whole, never stretched', () => {
    const p = placeArtwork({ ...full, kind: 'portrait' }, 0.63);
    expect(p.fills).toBe(false);
    expect(parseFloat(p.width)).toBeCloseTo((0.63 / CARD_RATIO) * 92, 0);
  });
});

describe('artwork order', () => {
  const catalog = new Map([
    ['us-a', { id: 'us-a', name: 'A Card', art: { primary: true, mirror: true } }],
    ['us-none', { id: 'us-none', name: 'None', art: { primary: false, mirror: false } }],
    ['us-synchrony-amazon-prime-store', { id: 'us-synchrony-amazon-prime-store', name: 'Amazon Prime Store Card', art: { primary: true, mirror: false } }],
  ]);
  it('offers the card artwork, then the mirror', () => {
    expect(artworkCandidates({ catalogId: 'us-a', name: 'A' }, catalog).map((c) => c.tier)).toEqual(['artwork', 'alternate']);
  });
  it('uses the older preset only for the same product', () => {
    const ids = (name) => artworkCandidates({ catalogId: 'us-none', presetId: 'store-amazon', name }, catalog).map((c) => c.catalogId);
    expect(ids('Amazon Store Card')).toEqual(['us-synchrony-amazon-prime-store']);
    expect(ids('Business Platinum')).toEqual([]);
    expect(sameProduct('Chase Card', 'Chase Anything')).toBe(false);
  });
  it('skips what fails to load or is not a card, and ends with null', async () => {
    const load = async (src) => { if (src === 'bad') throw new Error('404'); return { src, meta: { kind: src === 'photo' ? 'scene' : 'landscape' } }; };
    expect((await resolveArtwork([{ src: 'bad' }, { src: 'photo' }, { src: 'ok' }], load)).src).toBe('ok');
    expect(await resolveArtwork([{ src: 'bad' }, { src: 'photo' }], load)).toBe(null);
    expect(await resolveArtwork([], load)).toBe(null);
  });
});

describe('artCatalogIds', () => {
  it('asks for each credit card once, with its older preset', () => {
    expect(artCatalogIds([{ type: 'Credit', catalog_card_id: 'us-b', preset_card_id: 'store-amazon' }, { type: 'Credit', catalog_card_id: 'us-b' }, { type: 'Debit', catalog_card_id: 'us-x' }, { type: 'Credit' }])).toEqual(['us-b', 'us-synchrony-amazon-prime-store']);
    expect(artCatalogIds(undefined)).toEqual([]);
  });
});
