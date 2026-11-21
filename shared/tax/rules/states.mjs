// State individual income tax rules. A state is only calculated once its
// rules for that year have been checked against the state's own forms; every
// other state returns an explicit "not supported yet" limitation instead of a
// guess.
//
// type:   'none'      - no broad individual income tax on wages or business income
//         'flat'      - one rate on a state taxable income (later phase)
//         'brackets'  - progressive rates (later phase)
// status: 'verified' | 'unsupported'

// Secondary source for the list of nine; the state-rules phase replaces it
// with each state revenue agency's own page.
const NO_TAX_SOURCE = { label: 'Nine states without a broad individual income tax in 2026 (secondary source)', url: 'https://www.kiplinger.com/slideshow/taxes/t054-s001-states-without-income-tax/' };

export const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

// WA taxes some long-term capital gains only, and NH repealed its interest and
// dividends tax for years from 2025; neither taxes wages or Schedule C profit.
const NO_INCOME_TAX = {
  AK: null, FL: null, NV: null, SD: null, TN: null, TX: null, WY: null,
  NH: 'New Hampshire repealed its interest and dividends tax starting with 2025.',
  WA: 'Washington taxes certain long-term capital gains, which this estimate does not include.',
};

function rulesForYear(year) {
  const rules = {};
  for (const code of Object.keys(STATE_NAMES)) {
    rules[code] = code in NO_INCOME_TAX
      ? { type: 'none', status: 'verified', version: `${code}-${year}.1`, lastVerified: '2026-11-21', sources: [NO_TAX_SOURCE], note: NO_INCOME_TAX[code] }
      : { type: 'unsupported', status: 'unsupported', version: null };
  }
  return rules;
}

export const STATE_RULES = { 2025: rulesForYear(2025), 2026: rulesForYear(2026) };
