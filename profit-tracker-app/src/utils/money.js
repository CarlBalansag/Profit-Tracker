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

// A dollar amount with its sign in front of the $: -5 -> '-$5.00', 5 -> '$5.00'.
// For amounts that can go below zero (profit, net); '$' + formatMoney(-5) would
// read '$-5.00'.
export const formatDollars = (value) => {
  const number = Number(value);
  const amount = Number.isFinite(number) ? number : 0;
  return `${amount < 0 ? '-' : ''}$${formatMoney(Math.abs(amount))}`;
};

// Same, with a + on gains and zero: 5 -> '+$5.00', -5 -> '-$5.00'.
export const formatSignedDollars = (value) => {
  const number = Number(value);
  const amount = Number.isFinite(number) ? number : 0;
  return `${amount < 0 ? '-' : '+'}$${formatMoney(Math.abs(amount))}`;
};

// Whole dollars with the sign in front: -1234.4 -> '-$1,234'.
export const formatWholeDollars = (value) => {
  const number = Number(value);
  const amount = Number.isFinite(number) ? number : 0;
  const text = formatWholeMoney(Math.abs(amount));
  return `${amount < 0 && text !== '0' ? '-' : ''}$${text}`;
};
