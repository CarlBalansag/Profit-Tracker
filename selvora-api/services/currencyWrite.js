const fields = require('./currencyFields');
const { parseAmount } = require('./money');
function currencyWrite(model, data) {
  const result = { ...data };
  for (const kind of ['money', 'rate']) for (const field of fields[model]?.[kind] || []) {
    if (data[field] === undefined) continue;
    result[`${field}_decimal`] = data[field] === null || (model === 'Goal' && data.metric === 'unitsSold')
      ? null : parseAmount(data[field], kind === 'rate' ? 6 : 2).toFixed(kind === 'rate' ? 6 : 2);
  }
  return result;
}
module.exports = { currencyWrite };
