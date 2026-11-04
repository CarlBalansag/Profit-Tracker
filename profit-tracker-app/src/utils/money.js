// Display format for a dollar amount, without the $ sign: 1234.5 -> '1,234.50'.
// For showing amounts only. Form values and saved data keep plain numbers.
export const formatMoney = (value) => {
  const number = Number(value);
  return (Number.isFinite(number) ? number : 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};
