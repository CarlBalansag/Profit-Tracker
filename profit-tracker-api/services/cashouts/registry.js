const ebAdapter = require('./eb');
const p4dAdapter = require('./p4d');
const laAdapter = require('./la');

const ADAPTERS = {
  [ebAdapter.id]: ebAdapter,
  [p4dAdapter.id]: p4dAdapter,
  [laAdapter.id]: laAdapter,
};

// Every registered cashout is listed for every signed-in user. Whether a
// connection actually works depends only on the provider accepting the key --
// see service.js's createConnection, which grants cashout_access_granted the
// first time that check passes.
function listAvailableCashouts() {
  return Object.values(ADAPTERS).map((adapter) => ({
    id: adapter.id,
    name: adapter.name,
    settingsName: adapter.settingsName || adapter.name,
    // 'api_key' (paste a key) or 'login' (email and password).
    credentialType: adapter.credentialType || 'api_key',
    // Whether Log Purchase can commit through this cashout.
    supportsCommits: typeof adapter.createCommit === 'function',
  }));
}

function getAdapter(providerId) {
  const adapter = ADAPTERS[providerId];
  if (!adapter) {
    const error = new Error(`Unsupported cashout provider: "${providerId}"`);
    error.status = 400;
    throw error;
  }

  return adapter;
}

module.exports = {
  ADAPTERS,
  listAvailableCashouts,
  getAdapter,
};
