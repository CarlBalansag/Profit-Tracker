import Decimal from 'decimal.js';
import { createFinance } from '../../../shared/decimalFinance.mjs';
export const { batchCost, allocatedCost, effectiveCashbackRate, saleEconomics, realizedSummary, isRealizedSale,
  sumMoney, subtractMoney, multiplyMoney, percentageMoney, allocateMoney, batchCashback, saleOffset } = createFinance(Decimal);
