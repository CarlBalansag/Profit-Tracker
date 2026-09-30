const { Prisma } = require('@prisma/client');

const Decimal = Prisma.Decimal.clone({ precision: 40, rounding: Prisma.Decimal.ROUND_HALF_UP });
const MAX_MONEY = new Decimal('999999999999.99');
const MAX_RATE = new Decimal('100');

function decimal(value) {
  if (typeof value !== 'string' && typeof value !== 'number' && !Prisma.Decimal.isDecimal(value)) {
    throw new Error('Enter a decimal amount.');
  }
  if (typeof value === 'string' && !/^[-+]?\d+(?:\.\d+)?$/.test(value.trim())) {
    throw new Error('Enter a decimal amount.');
  }
  const result = new Decimal(value);
  if (!result.isFinite()) throw new Error('Amount must be finite.');
  return result;
}

// scale = 2 for money fields, scale = 6 for rate/percentage fields.
function parseAmount(value, scale = 2) {
  const result = decimal(value);
  if (result.isNegative()) throw new Error('Amount cannot be negative.');
  if (result.decimalPlaces() > scale) throw new Error(`Use no more than ${scale} decimal places.`);
  if (result.greaterThan(scale === 6 ? MAX_RATE : MAX_MONEY)) throw new Error('Amount exceeds the supported limit.');
  return result;
}

const moneyString = (value) => decimal(value).toFixed(2);
const rateString = (value) => decimal(value).toFixed(6);

const add = (...values) => values.reduce((sum, value) => sum.plus(decimal(value)), new Decimal(0));
const subtract = (left, right) => decimal(left).minus(decimal(right));
const multiply = (left, right) => decimal(left).times(decimal(right));

// Splits `total` across `units` whole shares (e.g. units sold from a purchased
// batch), returning the exact cent amount for the `quantity` shares starting
// at `offset`. Cumulative-boundary rounding (round the running total at each
// boundary, then take the difference) guarantees that summing every
// non-overlapping [offset, offset + quantity) range from 0 to `units` always
// equals `total` exactly, unlike rounding each unit's share independently.
function allocate(total, quantity, units, offset = 0) {
  const validQuantities = [quantity, units, offset].every(Number.isSafeInteger);
  if (!validQuantities || units <= 0 || quantity < 0 || offset < 0 || offset + quantity > units) {
    throw new Error('Invalid allocation quantities.');
  }
  const end = decimal(total).times(offset + quantity).div(units).toDecimalPlaces(2);
  const start = decimal(total).times(offset).div(units).toDecimalPlaces(2);
  return end.minus(start);
}

module.exports = { Decimal, decimal, parseAmount, moneyString, rateString, add, subtract, multiply, allocate };
