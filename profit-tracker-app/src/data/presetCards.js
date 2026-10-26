export const ISSUERS = [
  'All Issuers',
  'Chase',
  'American Express',
  'Citi',
  'Capital One',
  'Discover',
  'Wells Fargo',
  'Bank of America',
  'US Bank',
  'Store Cards',
  'Barclays'
];

// categoryRates: array of { store, rate, expires? }
//   store  — vendor name (case-insensitive match against Platform.name)
//   rate   — cashback % earned at that store
//   expires — ISO date string if the rate is a rotating quarterly rate, else omitted
//
// Q2 2026 rotating categories (Apr 1 – Jun 30 2026):
//   Chase Freedom / Freedom Flex: Amazon, Whole Foods, Chase Travel, Feeding America

export const PRESET_CARDS = [
  // ── CHASE ───────────────────────────────────────────────────────────────────

  { id: 'chase-ff',
    name: 'Chase Freedom Flex',
    issuer: 'Chase', baseRate: 1, annualFee: 0, storeRatesCount: 4,
    categoryRates: [
      // Rotating Q2 2026 (Amazon active now — expires Jun 30 2026)
      { store: 'Amazon',      rate: 5, expires: '2026-06-30' },
      { store: 'Whole Foods', rate: 5, expires: '2026-06-30' },
      // Always-on fixed categories
      { store: 'Chase Travel',  rate: 5 },
      { store: 'Dining',        rate: 3 },
      { store: 'Drugstore',     rate: 3 },
      { store: 'Walgreens',     rate: 3 },
      { store: 'CVS',           rate: 3 },
    ]
  },

  { id: 'chase-fu',
    name: 'Chase Freedom Unlimited',
    issuer: 'Chase', baseRate: 1.5, annualFee: 0, storeRatesCount: 2,
    categoryRates: [
      { store: 'Chase Travel', rate: 5 },
      { store: 'Dining',       rate: 3 },
      { store: 'Drugstore',    rate: 3 },
      { store: 'Walgreens',    rate: 3 },
      { store: 'CVS',          rate: 3 },
    ]
  },

  { id: 'chase-sr',
    name: 'Chase Sapphire Reserve',
    issuer: 'Chase', baseRate: 1, annualFee: 550, storeRatesCount: 3,
    categoryRates: [
      { store: 'Chase Travel',    rate: 10 },
      { store: 'Hotels',          rate: 10 },
      { store: 'Car Rental',      rate: 10 },
      { store: 'Dining',          rate: 3  },
      { store: 'Travel',          rate: 3  },
    ]
  },

  { id: 'chase-ink-pref',
    name: 'Chase Ink Business Preferred',
    issuer: 'Chase', baseRate: 1, annualFee: 95, storeRatesCount: 0,
    categoryRates: [
      { store: 'Travel',     rate: 3 },
      { store: 'Shipping',   rate: 3 },
      { store: 'Advertising', rate: 3 },
    ]
  },

  { id: 'chase-ink-unl',
    name: 'Chase Ink Business Unlimited',
    issuer: 'Chase', baseRate: 1.5, annualFee: 0, storeRatesCount: 0,
    categoryRates: []
  },

  { id: 'chase-ink-cash',
    name: 'Chase Ink Business Cash',
    issuer: 'Chase', baseRate: 1, annualFee: 0, storeRatesCount: 3,
    categoryRates: [
      { store: 'Office Depot',  rate: 5 },
      { store: 'Staples',       rate: 5 },
      { store: 'Dining',        rate: 2 },
      { store: 'Gas',           rate: 2 },
    ]
  },

  { id: 'chase-slate',
    name: 'Chase Slate Edge',
    issuer: 'Chase', baseRate: 0, annualFee: 0, storeRatesCount: 0,
    categoryRates: []
  },

  { id: 'chase-rise',
    name: 'Chase Freedom Rise',
    issuer: 'Chase', baseRate: 1.5, annualFee: 0, storeRatesCount: 0,
    categoryRates: []
  },

  { id: 'chase-ink-prem',
    name: 'Chase Ink Business Premier',
    issuer: 'Chase', baseRate: 2, annualFee: 195, storeRatesCount: 0,
    categoryRates: [
      { store: 'Travel', rate: 5 },
    ]
  },

  // ── AMERICAN EXPRESS ─────────────────────────────────────────────────────────

  { id: 'amex-bcp',
    name: 'Amex Blue Cash Preferred',
    issuer: 'American Express', baseRate: 1, annualFee: 95, storeRatesCount: 5,
    categoryRates: [
      { store: 'Grocery',     rate: 6 },
      { store: 'Supermarket', rate: 6 },
      { store: 'Whole Foods', rate: 6 },
      { store: 'Walmart',     rate: 6 }, // classified as supermarket
      { store: 'Target',      rate: 6 }, // classified as supermarket
      { store: 'Gas',         rate: 3 },
      { store: 'Transit',     rate: 3 },
      { store: 'Streaming',   rate: 6 },
    ]
  },

  { id: 'amex-bce',
    name: 'Amex Blue Cash Everyday',
    issuer: 'American Express', baseRate: 1, annualFee: 0, storeRatesCount: 3,
    categoryRates: [
      { store: 'Grocery',     rate: 3 },
      { store: 'Supermarket', rate: 3 },
      { store: 'Walmart',     rate: 3 },
      { store: 'Gas',         rate: 2 },
      { store: 'Amazon',      rate: 3 },
    ]
  },

  { id: 'amex-gold',
    name: 'Amex Gold Card',
    issuer: 'American Express', baseRate: 1, annualFee: 250, storeRatesCount: 4,
    categoryRates: [
      { store: 'Dining',      rate: 4 },
      { store: 'Restaurant',  rate: 4 },
      { store: 'Grocery',     rate: 4 },
      { store: 'Supermarket', rate: 4 },
      { store: 'Whole Foods', rate: 4 },
      { store: 'Flights',     rate: 3 },
    ]
  },

  { id: 'amex-plat',
    name: 'Amex Platinum Card',
    issuer: 'American Express', baseRate: 1, annualFee: 695, storeRatesCount: 2,
    categoryRates: [
      { store: 'Flights',  rate: 5 },
      { store: 'Airlines', rate: 5 },
      { store: 'Hotels',   rate: 5 },
    ]
  },

  { id: 'amex-biz-gold',
    name: 'Amex Business Gold',
    issuer: 'American Express', baseRate: 1, annualFee: 295, storeRatesCount: 0,
    categoryRates: [
      { store: 'Advertising', rate: 4 },
      { store: 'Gas',         rate: 4 },
      { store: 'Dining',      rate: 4 },
      { store: 'Shipping',    rate: 4 },
    ]
  },

  { id: 'amex-biz-plat',
    name: 'Amex Business Platinum',
    issuer: 'American Express', baseRate: 1.5, annualFee: 695, storeRatesCount: 0,
    categoryRates: [
      { store: 'Flights',  rate: 5 },
      { store: 'Airlines', rate: 5 },
      { store: 'Hotels',   rate: 5 },
    ]
  },

  { id: 'amex-green',  name: 'Amex Green Card',         issuer: 'American Express', baseRate: 1, annualFee: 150,  storeRatesCount: 0, categoryRates: [{ store: 'Travel', rate: 3 }, { store: 'Dining', rate: 3 }] },
  { id: 'amex-everyday',      name: 'Amex Everyday Card',      issuer: 'American Express', baseRate: 1, annualFee: 0,    storeRatesCount: 0, categoryRates: [{ store: 'Grocery', rate: 2 }, { store: 'Supermarket', rate: 2 }] },
  { id: 'amex-everyday-pref', name: 'Amex Everyday Preferred', issuer: 'American Express', baseRate: 1, annualFee: 95,   storeRatesCount: 0, categoryRates: [{ store: 'Grocery', rate: 3 }, { store: 'Supermarket', rate: 3 }, { store: 'Gas', rate: 2 }] },
  { id: 'amex-delta-gold',    name: 'Amex Delta Gold',         issuer: 'American Express', baseRate: 1, annualFee: 150,  storeRatesCount: 0, categoryRates: [{ store: 'Delta', rate: 2 }, { store: 'Airlines', rate: 2 }, { store: 'Dining', rate: 2 }] },
  { id: 'amex-delta-plat',    name: 'Amex Delta Platinum',     issuer: 'American Express', baseRate: 1, annualFee: 350,  storeRatesCount: 0, categoryRates: [{ store: 'Delta', rate: 3 }, { store: 'Airlines', rate: 3 }, { store: 'Dining', rate: 3 }] },
  { id: 'amex-hilton',        name: 'Amex Hilton Honors',      issuer: 'American Express', baseRate: 1, annualFee: 0,    storeRatesCount: 0, categoryRates: [{ store: 'Hilton', rate: 7 }, { store: 'Dining', rate: 5 }, { store: 'Grocery', rate: 5 }, { store: 'Gas', rate: 5 }] },
  { id: 'amex-hilton-surpass',name: 'Amex Hilton Surpass',     issuer: 'American Express', baseRate: 1, annualFee: 150,  storeRatesCount: 0, categoryRates: [{ store: 'Hilton', rate: 12 }, { store: 'Dining', rate: 6 }, { store: 'Grocery', rate: 6 }, { store: 'Gas', rate: 6 }] },

  // ── CITI ─────────────────────────────────────────────────────────────────────

  { id: 'citi-dc',
    name: 'Citi Double Cash',
    issuer: 'Citi', baseRate: 2, annualFee: 0, storeRatesCount: 0,
    categoryRates: []
  },

  { id: 'citi-custom',
    name: 'Citi Custom Cash',
    issuer: 'Citi', baseRate: 1, annualFee: 0, storeRatesCount: 3,
    // 5% on top spend category automatically (up to $500/mo); common categories below
    categoryRates: [
      { store: 'Grocery',     rate: 5 },
      { store: 'Dining',      rate: 5 },
      { store: 'Gas',         rate: 5 },
      { store: 'Amazon',      rate: 5 },
      { store: 'Walmart',     rate: 5 },
      { store: 'Target',      rate: 5 },
    ]
  },

  { id: 'citi-premier',   name: 'Citi Premier',         issuer: 'Citi', baseRate: 1, annualFee: 95, storeRatesCount: 0, categoryRates: [{ store: 'Hotels', rate: 3 }, { store: 'Airline', rate: 3 }, { store: 'Grocery', rate: 3 }, { store: 'Dining', rate: 3 }, { store: 'Gas', rate: 3 }] },
  { id: 'citi-rewards',   name: 'Citi Rewards+',        issuer: 'Citi', baseRate: 1, annualFee: 0,  storeRatesCount: 0, categoryRates: [{ store: 'Grocery', rate: 2 }, { store: 'Gas', rate: 2 }] },
  { id: 'citi-simplicity',name: 'Citi Simplicity',      issuer: 'Citi', baseRate: 0, annualFee: 0,  storeRatesCount: 0, categoryRates: [] },
  { id: 'citi-att',       name: 'Citi AT&T Points Plus', issuer: 'Citi', baseRate: 2, annualFee: 0, storeRatesCount: 0, categoryRates: [] },

  // ── CAPITAL ONE ───────────────────────────────────────────────────────────────

  { id: 'cap1-vx',         name: 'Capital One Venture X',         issuer: 'Capital One', baseRate: 2,    annualFee: 395, storeRatesCount: 2, categoryRates: [{ store: 'Hotels', rate: 10 }, { store: 'Car Rental', rate: 10 }, { store: 'Flights', rate: 5 }] },
  { id: 'cap1-v',          name: 'Capital One Venture',           issuer: 'Capital One', baseRate: 2,    annualFee: 95,  storeRatesCount: 0, categoryRates: [{ store: 'Hotels', rate: 5 }, { store: 'Car Rental', rate: 5 }] },
  { id: 'cap1-qs',         name: 'Capital One Quicksilver',       issuer: 'Capital One', baseRate: 1.5,  annualFee: 0,   storeRatesCount: 0, categoryRates: [] },
  { id: 'cap1-spark-plus', name: 'Capital One Spark Cash Plus',   issuer: 'Capital One', baseRate: 2,    annualFee: 150, storeRatesCount: 0, categoryRates: [{ store: 'Hotels', rate: 5 }, { store: 'Car Rental', rate: 5 }] },

  { id: 'cap1-savor',
    name: 'Capital One Savor',
    issuer: 'Capital One', baseRate: 1, annualFee: 95, storeRatesCount: 3,
    categoryRates: [
      { store: 'Dining',       rate: 3 },
      { store: 'Entertainment', rate: 3 },
      { store: 'Grocery',      rate: 3 },
      { store: 'Streaming',    rate: 3 },
    ]
  },

  { id: 'cap1-v-one',        name: 'Capital One VentureOne',    issuer: 'Capital One', baseRate: 1.25, annualFee: 0,  storeRatesCount: 0, categoryRates: [{ store: 'Hotels', rate: 5 }, { store: 'Car Rental', rate: 5 }] },
  { id: 'cap1-spark-cash',   name: 'Capital One Spark Cash',    issuer: 'Capital One', baseRate: 2,    annualFee: 95, storeRatesCount: 0, categoryRates: [] },
  { id: 'cap1-spark-miles',  name: 'Capital One Spark Miles',   issuer: 'Capital One', baseRate: 2,    annualFee: 95, storeRatesCount: 0, categoryRates: [{ store: 'Hotels', rate: 5 }, { store: 'Car Rental', rate: 5 }] },

  // ── DISCOVER ──────────────────────────────────────────────────────────────────

  { id: 'discover-cashback',
    name: 'Discover it Cash Back',
    issuer: 'Discover', baseRate: 1, annualFee: 0, storeRatesCount: 4,
    // Q2 2026: Amazon, Wholesale Clubs (rotating — expires Jun 30 2026)
    categoryRates: [
      { store: 'Amazon',    rate: 5, expires: '2026-06-30' },
      { store: 'Costco',    rate: 5, expires: '2026-06-30' },
      { store: "Sam's Club", rate: 5, expires: '2026-06-30' },
    ]
  },

  { id: 'discover-miles',
    name: 'Discover it Miles',
    issuer: 'Discover', baseRate: 1.5, annualFee: 0, storeRatesCount: 0,
    categoryRates: []
  },

  // ── WELLS FARGO ───────────────────────────────────────────────────────────────

  { id: 'wf-active',   name: 'Wells Fargo Active Cash',      issuer: 'Wells Fargo', baseRate: 2,   annualFee: 0, storeRatesCount: 0, categoryRates: [] },
  { id: 'wf-autograph',name: 'Wells Fargo Autograph',        issuer: 'Wells Fargo', baseRate: 1,   annualFee: 0, storeRatesCount: 3, categoryRates: [{ store: 'Dining', rate: 3 }, { store: 'Gas', rate: 3 }, { store: 'Travel', rate: 3 }, { store: 'Streaming', rate: 3 }, { store: 'Grocery', rate: 3 }] },
  { id: 'wf-reflect',  name: 'Wells Fargo Reflect Card',     issuer: 'Wells Fargo', baseRate: 0,   annualFee: 0, storeRatesCount: 0, categoryRates: [] },
  { id: 'wf-bilt',     name: 'Wells Fargo Bilt Mastercard',  issuer: 'Wells Fargo', baseRate: 1,   annualFee: 0, storeRatesCount: 0, categoryRates: [{ store: 'Dining', rate: 3 }, { store: 'Travel', rate: 2 }] },
  { id: 'wf-attune',   name: 'Wells Fargo Attune Card',      issuer: 'Wells Fargo', baseRate: 4,   annualFee: 0, storeRatesCount: 0, categoryRates: [{ store: 'Wellness', rate: 4 }, { store: 'Transit', rate: 4 }] },

  // ── BANK OF AMERICA ───────────────────────────────────────────────────────────

  { id: 'boa-custom',
    name: 'Bank of America Customized Cash',
    issuer: 'Bank of America', baseRate: 1, annualFee: 0, storeRatesCount: 3,
    categoryRates: [
      { store: 'Gas',      rate: 3 },
      { store: 'Grocery',  rate: 2 },
      { store: 'Walmart',  rate: 2 },
      { store: 'Target',   rate: 2 },
      { store: 'Amazon',   rate: 3 }, // online shopping category
      { store: 'Dining',   rate: 3 }, // if chosen as top category
    ]
  },

  { id: 'boa-unl',        name: 'Bank of America Unlimited Cash',          issuer: 'Bank of America', baseRate: 1.5, annualFee: 0,   storeRatesCount: 0, categoryRates: [] },
  { id: 'boa-prem',       name: 'Bank of America Premium Rewards',         issuer: 'Bank of America', baseRate: 1.5, annualFee: 95,  storeRatesCount: 0, categoryRates: [{ store: 'Travel', rate: 2 }, { store: 'Dining', rate: 2 }] },
  { id: 'boa-travel',     name: 'Bank of America Travel Rewards',          issuer: 'Bank of America', baseRate: 1.5, annualFee: 0,   storeRatesCount: 0, categoryRates: [] },
  { id: 'boa-prem-elite', name: 'Bank of America Premium Rewards Elite',   issuer: 'Bank of America', baseRate: 2,   annualFee: 550, storeRatesCount: 0, categoryRates: [{ store: 'Travel', rate: 3.5 }, { store: 'Dining', rate: 3.5 }] },

  // ── US BANK ───────────────────────────────────────────────────────────────────

  { id: 'usbank-cashplus',
    name: 'US Bank Cash+',
    issuer: 'US Bank', baseRate: 1, annualFee: 0, storeRatesCount: 4,
    categoryRates: [
      // User chooses 2 categories at 5% and 1 at 2%
      { store: 'Electronics', rate: 5 },
      { store: 'Sporting Goods', rate: 5 },
      { store: 'Department Stores', rate: 5 },
      { store: 'Grocery',  rate: 2 },
      { store: 'Dining',   rate: 5 },
    ]
  },

  { id: 'usbank-alt-go',       name: 'US Bank Altitude Go',               issuer: 'US Bank', baseRate: 1,   annualFee: 0,   storeRatesCount: 2, categoryRates: [{ store: 'Dining', rate: 4 }, { store: 'Grocery', rate: 2 }, { store: 'Gas', rate: 2 }, { store: 'Streaming', rate: 2 }] },
  { id: 'usbank-alt-res',      name: 'US Bank Altitude Reserve',          issuer: 'US Bank', baseRate: 1.5, annualFee: 400, storeRatesCount: 0, categoryRates: [{ store: 'Travel', rate: 3 }, { store: 'Mobile Wallet', rate: 3 }] },
  { id: 'usbank-alt-conn',     name: 'US Bank Altitude Connect',          issuer: 'US Bank', baseRate: 1,   annualFee: 95,  storeRatesCount: 0, categoryRates: [{ store: 'Travel', rate: 5 }, { store: 'Gas', rate: 4 }, { store: 'Dining', rate: 2 }, { store: 'Streaming', rate: 2 }] },
  { id: 'usbank-alt-res-biz',  name: 'US Bank Altitude Reserve Business', issuer: 'US Bank', baseRate: 1.5, annualFee: 400, storeRatesCount: 0, categoryRates: [{ store: 'Travel', rate: 3 }, { store: 'Mobile Wallet', rate: 3 }] },

  // ── BARCLAYS ──────────────────────────────────────────────────────────────────

  { id: 'barc-arrival',  name: 'Barclays Arrival Plus',      issuer: 'Barclays', baseRate: 2, annualFee: 89, storeRatesCount: 0, categoryRates: [{ store: 'Travel', rate: 2 }] },
  { id: 'barc-aviator',  name: 'Barclays Aviator Red',       issuer: 'Barclays', baseRate: 1, annualFee: 99, storeRatesCount: 0, categoryRates: [{ store: 'American Airlines', rate: 2 }, { store: 'AA', rate: 2 }] },
  { id: 'barc-wyndham',  name: 'Barclays Wyndham Rewards',   issuer: 'Barclays', baseRate: 1, annualFee: 95, storeRatesCount: 0, categoryRates: [{ store: 'Wyndham', rate: 5 }, { store: 'Gas', rate: 2 }] },

  // ── STORE CARDS ───────────────────────────────────────────────────────────────

  { id: 'store-target',  name: 'Target RedCard',             issuer: 'Store Cards', brand: 'Target',       baseRate: 5,   annualFee: 0, storeRatesCount: 2,
    categoryRates: [{ store: 'Target', rate: 5 }]
  },
  { id: 'store-amazon',  name: 'Amazon Store Card',          issuer: 'Store Cards', brand: 'Amazon',       baseRate: 5,   annualFee: 0, storeRatesCount: 2,
    categoryRates: [{ store: 'Amazon', rate: 5 }, { store: 'Whole Foods', rate: 5 }]
  },
  { id: 'store-hd',      name: 'Home Depot Consumer Card',   issuer: 'Store Cards', brand: 'Home Depot',   baseRate: 0,   annualFee: 0, storeRatesCount: 1, categoryRates: [] },
  { id: 'store-lowes',   name: "Lowe's Advantage Card",      issuer: 'Store Cards', brand: "Lowe's",       baseRate: 5,   annualFee: 0, storeRatesCount: 1,
    categoryRates: [{ store: "Lowe's", rate: 5 }]
  },
  { id: 'store-bb',      name: 'Best Buy Credit Card',       issuer: 'Store Cards', brand: 'Best Buy',     baseRate: 5,   annualFee: 0, storeRatesCount: 2,
    categoryRates: [{ store: 'Best Buy', rate: 5 }]
  },
  { id: 'store-costco',  name: 'Costco Anywhere Visa',       issuer: 'Store Cards', brand: 'Costco',       baseRate: 2,   annualFee: 0, storeRatesCount: 2,
    categoryRates: [{ store: 'Costco', rate: 4 }, { store: 'Gas', rate: 4 }, { store: 'Dining', rate: 3 }, { store: 'Travel', rate: 3 }]
  },
  { id: 'store-sams',    name: "Sam's Club Mastercard",      issuer: 'Store Cards', brand: "Sam's Club",   baseRate: 1,   annualFee: 0, storeRatesCount: 0,
    categoryRates: [{ store: "Sam's Club", rate: 5 }, { store: 'Walmart', rate: 5 }, { store: 'Gas', rate: 5 }, { store: 'Dining', rate: 3 }]
  },
  { id: 'store-walmart', name: 'Walmart Rewards Card',       issuer: 'Store Cards', brand: 'Walmart',      baseRate: 2,   annualFee: 0, storeRatesCount: 0,
    categoryRates: [{ store: 'Walmart', rate: 5 }, { store: 'Walmart.com', rate: 5 }]
  },
  { id: 'store-apple',   name: 'Apple Card',                 issuer: 'Store Cards', brand: 'Apple',        baseRate: 1,   annualFee: 0, storeRatesCount: 0,
    categoryRates: [{ store: 'Apple', rate: 3 }]
  },
  { id: 'store-paypal',  name: 'PayPal Cashback Mastercard', issuer: 'Store Cards', brand: 'PayPal',       baseRate: 3,   annualFee: 0, storeRatesCount: 0, categoryRates: [] },
  { id: 'store-venmo',   name: 'Venmo Credit Card',          issuer: 'Store Cards', brand: 'Venmo',        baseRate: 1,   annualFee: 0, storeRatesCount: 0, categoryRates: [] },
  { id: 'store-ikea',    name: 'IKEA Visa',                  issuer: 'Store Cards', brand: 'IKEA',         baseRate: 1,   annualFee: 0, storeRatesCount: 0,
    categoryRates: [{ store: 'IKEA', rate: 5 }]
  },
  { id: 'store-wayfair', name: 'Wayfair Credit Card',        issuer: 'Store Cards', brand: 'Wayfair',      baseRate: 3,   annualFee: 0, storeRatesCount: 0,
    categoryRates: [{ store: 'Wayfair', rate: 5 }]
  },
  { id: 'store-macys',   name: "Macy's Credit Card",         issuer: 'Store Cards', brand: "Macy's",       baseRate: 1,   annualFee: 0, storeRatesCount: 0,
    categoryRates: [{ store: "Macy's", rate: 5 }]
  },
  { id: 'store-nord',    name: 'Nordstrom Card',             issuer: 'Store Cards', brand: 'Nordstrom',    baseRate: 1,   annualFee: 0, storeRatesCount: 0,
    categoryRates: [{ store: 'Nordstrom', rate: 3 }]
  },
  { id: 'store-gap',     name: 'Gap Good Rewards Card',      issuer: 'Store Cards', brand: 'Gap',          baseRate: 1,   annualFee: 0, storeRatesCount: 0,
    categoryRates: [{ store: 'Gap', rate: 5 }, { store: 'Old Navy', rate: 5 }, { store: 'Banana Republic', rate: 5 }]
  },
];
