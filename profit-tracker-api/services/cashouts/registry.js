const ebAdapter = require('./eb');

const ADAPTERS = {
  [ebAdapter.id]: ebAdapter,
};

function getBetaUserIds() {
  const raw = process.env.CASHOUT_BETA_USER_IDS || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isProviderAllowedForUser(adapter, userId) {
  if (!adapter) return false;
  if (adapter.public) return true;
  if (!userId) return false;

  const betaUsers = getBetaUserIds();
  return betaUsers.includes(userId);
}

function listAvailableCashouts(userId) {
  return Object.values(ADAPTERS)
    .filter((adapter) => isProviderAllowedForUser(adapter, userId))
    .map((adapter) => ({
      id: adapter.id,
      name: adapter.name,
      public: adapter.public,
    }));
}

function getAdapter(providerId, userId) {
  const adapter = ADAPTERS[providerId];
  if (!adapter) {
    const error = new Error(`Unsupported cashout provider: "${providerId}"`);
    error.status = 400;
    throw error;
  }

  if (userId && !isProviderAllowedForUser(adapter, userId)) {
    const error = new Error(`Access to cashout provider "${providerId}" is restricted.`);
    error.status = 403;
    throw error;
  }

  return adapter;
}

module.exports = {
  ADAPTERS,
  listAvailableCashouts,
  getAdapter,
  isProviderAllowedForUser,
};
