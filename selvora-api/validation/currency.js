const { z } = require('zod');
const { parseAmount } = require('../services/money');
const exactValue = scale => z.union([z.number(), z.string()]).transform((value, ctx) => {
  try { return parseAmount(value, scale).toNumber(); }
  catch (error) { ctx.addIssue({ code: 'custom', message: error.message }); return z.NEVER; }
});
const optionalCurrency = (scale = 2) => z.preprocess(value => value === '' ? undefined : value, exactValue(scale).optional());
module.exports = { exactValue, optionalCurrency };
