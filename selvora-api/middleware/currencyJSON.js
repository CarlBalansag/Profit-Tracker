const { decimal, Decimal } = require('../services/money');
const contract = import('../../shared/currencyContract.mjs');
async function currencyJSON(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  const { moneyKeys, rateKeys } = await contract;
  const exact = req.headers['x-currency-format'] === 'decimal';
  const walk = input => {
    if (Decimal.isDecimal(input)) return input.toString();
    if (input instanceof Date) return input;
    if (Array.isArray(input)) return input.map(walk);
    if (!input || typeof input !== 'object') return input;
    return Object.fromEntries(Object.entries(input).map(([key, value]) => {
      if ((moneyKeys.has(key) || rateKeys.has(key)) && value != null && !(key.startsWith('target_') && input.metric === 'unitsSold')) {
        const normalized = decimal(input[`${key}_decimal`] ?? value).toFixed(rateKeys.has(key) ? 6 : 2);
        return [key, exact ? normalized : Number(normalized)];
      }
      return [key, walk(value)];
    }));
  };
  const json = res.json.bind(res);
  res.json = body => json(walk(body));
  next();
}
module.exports = currencyJSON;
