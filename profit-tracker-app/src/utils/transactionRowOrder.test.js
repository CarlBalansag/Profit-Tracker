import { describe, expect, it } from 'vitest';
import { orderTransactionRows } from './transactionRowOrder';

const buy = (rawId, date) => ({ id: `${rawId}_unsold`, rawId, isSale: false, date });
const sale = (rawId, id, date) => ({ id, rawId, isSale: true, date });
const ids = (rows) => orderTransactionRows(rows).map((r) => r.id);

describe('orderTransactionRows', () => {
  it('puts a same-day sale above the buy it came from, keeping each pair together', () => {
    // Built the way Transactions builds them: each purchase's BUY, then its sales.
    const rows = [
      buy('fire4k', '11/18/2026'), sale('fire4k', 's1', '11/18/2026'),
      buy('firehd', '11/18/2026'), sale('firehd', 's2', '11/18/2026'),
      buy('quest', '11/16/2026'),
    ];
    expect(ids(rows)).toEqual(['s1', 'fire4k_unsold', 's2', 'firehd_unsold', 'quest_unsold']);
  });

  it('keeps several same-day sales of one purchase in order, all above its buy', () => {
    const rows = [buy('a', '11/18/2026'), sale('a', 's1', '11/18/2026'), sale('a', 's2', '11/18/2026')];
    expect(ids(rows)).toEqual(['s1', 's2', 'a_unsold']);
  });

  it('still sorts newest day first: a later sale goes above, an older buy below', () => {
    const rows = [
      buy('a', '11/10/2026'), sale('a', 'late', '11/18/2026'),
      buy('b', '11/15/2026'),
    ];
    expect(ids(rows)).toEqual(['late', 'b_unsold', 'a_unsold']);
  });

  it('leaves unsold purchases and different purchases in their built order', () => {
    const rows = [buy('a', '11/18/2026'), buy('b', '11/18/2026'), sale('c', 's', '11/17/2026'), buy('c', '11/17/2026')];
    expect(ids(rows)).toEqual(['a_unsold', 'b_unsold', 's', 'c_unsold']);
  });

  it('sends rows with no date to the bottom without throwing, and does not mutate the input', () => {
    const rows = [buy('a', '—'), buy('b', '11/18/2026')];
    const copy = [...rows];
    expect(ids(rows)).toEqual(['b_unsold', 'a_unsold']);
    expect(rows).toEqual(copy);
  });
});
