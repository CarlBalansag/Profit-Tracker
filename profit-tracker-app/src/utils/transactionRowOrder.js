// Order for the Transactions list: newest day first. On the same day, a
// purchase's SALE rows sit above its BUY row -- the sale came after the buy,
// so in a newest-first list it reads top-down as "sold, bought". Everything
// else keeps the order the rows were built in (each purchase's rows together).
// `date` is any value `new Date()` understands; rows from one purchase share
// a `rawId` and are built next to each other.
export function orderTransactionRows(rows) {
  const built = new Map(rows.map((row, i) => [row, i]));
  const time = (row) => {
    const t = new Date(row.date).getTime();
    return Number.isNaN(t) ? -Infinity : t;
  };
  return [...rows].sort((a, b) => {
    const byDay = time(b) - time(a);
    if (byDay) return byDay;
    if (a.rawId === b.rawId && a.isSale !== b.isSale) return a.isSale ? -1 : 1;
    return built.get(a) - built.get(b);
  });
}
