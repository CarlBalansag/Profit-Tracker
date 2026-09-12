const { Decimal } = require('./money');
module.exports = import('../../shared/decimalFinance.mjs').then(({ createFinance }) => createFinance(Decimal, { strict: true }));
