// Fallback card designs, used when there is no usable artwork. Colours only
// suggest the issuer; no issuer logos are drawn.
const THEMES = [
  [/american express|amex/i, { name: 'American Express', from: '#2b5f9e', via: '#1d4678', to: '#10294a', ink: '#f2f7ff' }],
  [/chase/i, { name: 'Chase', from: '#1c5fb0', via: '#0f3f80', to: '#071f45', ink: '#f1f6ff' }],
  [/capital one/i, { name: 'Capital One', from: '#1f4f78', via: '#0e3253', to: '#071a2e', ink: '#f1f7fb' }],
  [/citi(?!zens)/i, { name: 'Citi', from: '#1a6fb8', via: '#0c4b8a', to: '#062a52', ink: '#f0f7ff' }],
  [/discover/i, { name: 'Discover', from: '#c0642a', via: '#7d4120', to: '#2d1d18', ink: '#fff5ec' }],
  [/wells fargo/i, { name: 'Wells Fargo', from: '#b3252c', via: '#7f141c', to: '#3a0a10', ink: '#fff1ec' }],
  [/bank of america/i, { name: 'Bank of America', from: '#c3223a', via: '#7c1a34', to: '#1c2348', ink: '#fff1f2' }],
  [/u\.?s\.? bank/i, { name: 'U.S. Bank', from: '#2b4fa8', via: '#182f72', to: '#0b1638', ink: '#f1f4ff' }],
  [/barclays/i, { name: 'Barclays', from: '#147fae', via: '#0b5f8c', to: '#063449', ink: '#eefaff' }],
  [/synchrony/i, { name: 'Synchrony', from: '#3c5a6e', via: '#263d4c', to: '#121f28', ink: '#f2f8fb' }],
  [/goldman|apple/i, { name: 'Apple Card', from: '#f4f4f5', via: '#e2e3e6', to: '#c9cbd0', ink: '#1c1d21' }],
  [/td bank|^td\b/i, { name: 'TD', from: '#23803e', via: '#176634', to: '#0a331a', ink: '#f0fff4' }],
  [/navy federal/i, { name: 'Navy Federal', from: '#27568a', via: '#153457', to: '#0a1a2d', ink: '#f1f7ff' }],
  [/usaa/i, { name: 'USAA', from: '#2a4a6d', via: '#152d47', to: '#0a1726', ink: '#f1f6fb' }],
  [/pnc/i, { name: 'PNC', from: '#a85b1f', via: '#41464d', to: '#22262b', ink: '#fff6ee' }],
  [/penfed/i, { name: 'PenFed', from: '#1f5aa0', via: '#123963', to: '#091d33', ink: '#f0f6ff' }],
];
const NETWORKS = {
  visa: { from: '#34406e', via: '#222b50', to: '#12172d', ink: '#f2f4ff' },
  mastercard: { from: '#4a3b3a', via: '#2f2625', to: '#181313', ink: '#fff5f0' },
  amex: { from: '#2b5f9e', via: '#1d4678', to: '#10294a', ink: '#f2f7ff' },
  discover: { from: '#5a4034', via: '#3a2a24', to: '#1c1513', ink: '#fff5ec' },
};
const PLAIN = { from: '#44484f', via: '#2d3035', to: '#191b1e', ink: '#f3f4f6' };

const issuerTheme = (card) => THEMES.find(([pattern]) => pattern.test(card.issuer || ''))?.[1];

// { tier: 'issuer' | 'network', name, from, via, to, ink }
export function fallbackTheme(card) {
  const theme = issuerTheme(card);
  if (theme) return { tier: 'issuer', ...theme };
  return { tier: 'network', name: card.issuer || null, ...(NETWORKS[card.network] || PLAIN) };
}

// "Chase Freedom Flex Card" on a Chase card -> "Freedom Flex".
export function productName(card) {
  let name = String(card.name || '').replace(/[®™℠]/g, '');
  const issuer = issuerTheme(card)?.name || card.issuer;
  if (issuer) name = name.replace(new RegExp(`(\\s*from\\s*)?\\b${issuer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'i'), ' ');
  name = name.replace(/\bU\.?S\.? Bank\b/i, ' ').replace(/\b(credit )?card\b/gi, ' ').replace(/\s+/g, ' ').trim();
  return name || card.name;
}
