// Row layout for the Home services honeycomb (pure — unit-testable).
//
// - Up to `wideOver` services: the classic nestled honeycomb that alternates
//   rows of 3 and 2 (e.g. 5 services => a 3-top / 2-bottom cluster).
// - More than `wideOver`: a HORIZONTAL two-row band — split roughly in half
//   (top = ceil, bottom = floor) so the honeycomb grows sideways, not downward.
//   Pair with the `.honeycomb.hc-wide` class (and `.hc-wide-even` when the two
//   rows are equal length, so alternate rows offset to interlock).
export function honeycombRows(items, { wideOver = 6 } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (list.length > wideOver) {
    const top = Math.ceil(list.length / 2);
    return [list.slice(0, top), list.slice(top)];
  }
  const rows = [];
  let i = 0;
  let cap = 3;
  while (i < list.length) {
    rows.push(list.slice(i, i + cap));
    i += cap;
    cap = cap === 3 ? 2 : 3;
  }
  return rows;
}

// Whether the wide two-row band layout should be used for a given count.
export function isWide(count, wideOver = 6) { return count > wideOver; }
