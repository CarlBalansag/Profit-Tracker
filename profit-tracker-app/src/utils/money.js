// Display format for a dollar amount, without the $ sign: 1234.5 -> '1,234.50'.
// For showing amounts only. Form values and saved data keep plain numbers.
export const formatMoney = (value) => {
  const number = Number(value);
  return (Number.isFinite(number) ? number : 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

// Same, rounded to whole dollars: 1234.5 -> '1,235'. For tight spots like the Dashboard.
export const formatWholeMoney = (value) => {
  const number = Number(value);
  return (Number.isFinite(number) ? number : 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
};
