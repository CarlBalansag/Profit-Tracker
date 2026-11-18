// Rebuilds the bundled card catalog snapshot (data/opencard-us.json) from the
// latest OpenCard DB export. The live app refreshes its own cached copy about
// once a month; this snapshot is only the fallback shipped with the code, so
// run this now and then (e.g. before a release):
//
//   npm run cards:refresh
const fs = require('node:fs');
const path = require('node:path');
const { downloadCatalog, SOURCE_URL } = require('../services/cardCatalog');

(async () => {
  const cards = await downloadCatalog();
  const lastVerified = cards.reduce((m, c) => (c.last_verified && c.last_verified > m ? c.last_verified : m), '');
  const out = {
    source: SOURCE_URL,
    license: 'OpenCard DB data, CC BY 4.0 (https://github.com/thedavidweng/opencard-db)',
    synced_at: new Date().toISOString(),
    last_verified: lastVerified || null,
    cards,
  };
  const file = path.join(__dirname, '..', 'data', 'opencard-us.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out) + '\n');
  console.log(`Wrote ${cards.length} cards to ${file} (newest verified ${out.last_verified})`);
})().catch(err => { console.error(err); process.exit(1); });
