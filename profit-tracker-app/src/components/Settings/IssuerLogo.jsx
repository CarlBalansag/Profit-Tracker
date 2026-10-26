import React, { useState } from 'react';

// Map each issuer name to its local SVG file in /assets/payment_methods/
// NOTE (DB migration): When moving to a real database, replace these local imports
// with: <img src={card.image_url} /> where image_url is stored in the DB as an S3/CDN URL.
const ISSUER_IMAGE_MAP = {
  'Chase':              new URL('../../assets/payment_methods/chase.svg', import.meta.url).href,
  'American Express':   new URL('../../assets/payment_methods/amex.png', import.meta.url).href,
  'Citi':               new URL('../../assets/payment_methods/citi.svg', import.meta.url).href,
  'Capital One':        new URL('../../assets/payment_methods/capitalone.png', import.meta.url).href,
  'Discover':           new URL('../../assets/payment_methods/discover.png', import.meta.url).href,
  'Wells Fargo':        new URL('../../assets/payment_methods/wellsfargo.svg', import.meta.url).href,
  'Bank of America':    new URL('../../assets/payment_methods/bankofamerica.png', import.meta.url).href,
  'US Bank':            new URL('../../assets/payment_methods/usbank.png', import.meta.url).href,
  'Barclays':           new URL('../../assets/payment_methods/barclays.png', import.meta.url).href,
  'Target':             new URL('../../assets/payment_methods/target.svg', import.meta.url).href,
  'Amazon':             new URL('../../assets/payment_methods/amazon.svg', import.meta.url).href,
  'Best Buy':           new URL('../../assets/payment_methods/bestbuy.svg', import.meta.url).href,
  'Apple':              new URL('../../assets/payment_methods/apple.svg', import.meta.url).href,
  'PayPal':             new URL('../../assets/payment_methods/paypal.svg', import.meta.url).href,
  'Walmart':            new URL('../../assets/payment_methods/walmart.png', import.meta.url).href,
  'Costco':             new URL('../../assets/payment_methods/costco.svg', import.meta.url).href,
  'Home Depot':         new URL('../../assets/payment_methods/homedepot.png', import.meta.url).href,
  "Lowe's":             new URL('../../assets/payment_methods/lowes.png', import.meta.url).href,
  'Synchrony':          new URL('../../assets/payment_methods/synchrony.svg', import.meta.url).href,
  'Goldman Sachs':      new URL('../../assets/payment_methods/goldmansachs.svg', import.meta.url).href,
  "Sam's Club":         new URL('../../assets/payment_methods/samsclub.png', import.meta.url).href,
  'IKEA':               new URL('../../assets/payment_methods/ikea.png', import.meta.url).href,
  'Venmo':              new URL('../../assets/payment_methods/venmo.png', import.meta.url).href,
  'SoFi':               new URL('../../assets/payment_methods/sofi.svg', import.meta.url).href,
  'TD Bank':            new URL('../../assets/payment_methods/tdbank.svg', import.meta.url).href,
  'Nordstrom':          new URL('../../assets/payment_methods/nordstrom.svg', import.meta.url).href,
  "Macy's":             new URL('../../assets/payment_methods/macys.png', import.meta.url).href,
  'Wayfair':            new URL('../../assets/payment_methods/wayfair.png', import.meta.url).href,
  'Gap':                new URL('../../assets/payment_methods/gap.png', import.meta.url).href,
};

// Fallback colored boxes if no image exists for this issuer
const getIssuerColor = (issuer) => {
  const colors = {
    'Chase': 'bg-blue-600', 'American Express': 'bg-blue-500', 'Citi': 'bg-blue-800',
    'Capital One': 'bg-red-700', 'Discover': 'bg-orange-500', 'Wells Fargo': 'bg-red-600',
    'Bank of America': 'bg-red-500', 'US Bank': 'bg-blue-900', 'Barclays': 'bg-cyan-600',
    'Store Cards': 'bg-purple-600',
  };
  return colors[issuer] || 'bg-gray-600';
};

const getIssuerInitial = (issuer) => issuer.substring(0, 2).toUpperCase();

export const IssuerLogo = ({ issuer, brand, className = 'w-10 h-10' }) => {
  const [imgError, setImgError] = useState(false);
  // For store cards, try the brand (e.g. "Target") before the generic issuer ("Store Cards")
  const imageSrc = ISSUER_IMAGE_MAP[brand] || ISSUER_IMAGE_MAP[issuer];

  if (imageSrc && !imgError) {
    return (
      <div className={`${className} rounded-xl bg-white overflow-hidden flex items-center justify-center flex-shrink-0 p-1.5`}>
        <img
          src={imageSrc}
          alt={brand || issuer}
          className="w-full h-full object-contain"
          onError={() => setImgError(true)}
        />
      </div>
    );
  }

  // Fallback: colour box with initials
  return (
    <div className={`${className} ${getIssuerColor(issuer)} rounded-xl flex items-center justify-center shadow-inner flex-shrink-0`}>
      <span className="text-white font-bold text-[10px] tracking-tighter uppercase">{getIssuerInitial(issuer)}</span>
    </div>
  );
};
