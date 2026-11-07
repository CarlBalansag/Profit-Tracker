const ebAdapter = require('./eb');

const ADAPTERS = {
  [ebAdapter.id]: ebAdapter,
};

// Every registered cashout is listed for every signed-in user. Whether a
// connection actually works depends only on the provider accepting the key --
// see service.js's createConnection, which grants cashout_access_granted the
// first time that check passes.
function listAvailableCashouts() {
  return Object.values(ADAPTERS).map((adapter) => ({
    id: adapter.id,
    name: adapter.name,
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
