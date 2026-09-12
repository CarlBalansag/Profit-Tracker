const { Prisma } = require('@prisma/client');
const Decimal = Prisma.Decimal.clone({ precision: 40, rounding: Prisma.Decimal.ROUND_HALF_UP });
const MAX_AMOUNT = new Decimal('999999999999.99');
function decimal(value) {
  if (typeof value !== 'string' && typeof value !== 'number' && !Prisma.Decimal.isDecimal(value)) throw new Error('Enter a decimal amount.');
  if (typeof value === 'string' && !/^[-+]?\d+(?:\.\d+)?$/.test(value.trim())) throw new Error('Enter a decimal amount.');
  const result = new Decimal(value);
  if (!result.isFinite()) throw new Error('Amount must be finite.');
  return result;
}
function parseAmount(value, scale = 2) {
  const result = decimal(value);
  if (result.isNegative()) throw new Error('Amount cannot be negative.');
  if (result.decimalPlaces() > scale) throw new Error(`Use no more than ${scale} decimal places.`);
  if (result.greaterThan(scale === 6 ? '100' : MAX_AMOUNT)) throw new Error('Amount exceeds the supported limit.');
  return result;
}
const moneyString = value => decimal(value).toFixed(2);
const add = (...values) => values.reduce((sum, value) => sum.plus(decimal(value)), new Decimal(0));
const subtract = (left, right) => decimal(left).minus(decimal(right));
const multiply = (left, right) => decimal(left).times(decimal(right));
function allocate(total, quantity, units, offset = 0) {
  if (![quantity, units, offset].every(Number.isSafeInteger) || units <= 0 || quantity < 0 || offset < 0 || offset + quantity > units) throw new Error('Invalid allocation quantities.');
  const end = decimal(total).times(offset + quantity).div(units).toDecimalPlaces(2);
  const start = decimal(total).times(offset).div(units).toDecimalPlaces(2);
  return end.minus(start);
}
module.exports = { Decimal, decimal, parseAmount, moneyString, add, subtract, multiply, allocate };
