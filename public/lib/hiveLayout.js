// Pure layout math for the sidebar honeycomb ("hive").
//
// When the number of nav cells exceeds `cap`, we keep the vertical rail short
// and move the overflow into a collapsible flyout that extends out to the right
// of the sidebar — so the nav never needs a scrollbar. The last `bottomCount`
// cells (Settings, and Log out when present) stay pinned at the bottom of the
// rail; the middle cells fill up to the cap, and everything past that goes to
// the flyout. One rail slot is reserved for the "More" toggle.
//
// Returns counts only (no DOM) so it can be unit-tested.
export function splitHive(count, { cap = 10, bottomCount = 1 } = {}) {
  count = Math.max(0, Math.floor(count));
  bottomCount = Math.max(0, Math.min(bottomCount, count));
  if (count <= cap) {
    return { overflow: false, railMidCount: count - bottomCount, flyCount: 0, moreIndex: -1, railCount: count };
  }
  const rest = count - bottomCount;                 // top + middle cells
  const railMidCap = Math.max(1, cap - bottomCount - 1); // reserve 1 slot for "More"
  const railMidCount = Math.min(rest, railMidCap);
  const flyCount = rest - railMidCount;
  return {
    overflow: flyCount > 0,
    railMidCount,
    flyCount,
    moreIndex: railMidCount,                         // index of the More toggle in the rail
    railCount: railMidCount + 1 + bottomCount,       // mid + More + bottom
  };
}

// Positions for the flyout hexes laid out as a `cols`-wide flat-top honeycomb
// (odd columns nudged down half a hex so they tessellate). Pure math → testable.
export function flyoutLayout(n, { W = 100, H = 88, oy = 10, cols = 2 } = {}) {
  const dx = 0.75 * W;
  const positions = [];
  for (let i = 0; i < n; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions.push({ x: col * dx, y: oy + row * H + (col % 2 ? H / 2 : 0) });
  }
  const rows = Math.ceil(n / cols) || 0;
  const width = (cols - 1) * dx + W;
  const height = oy + rows * H + (cols > 1 && n > 1 ? H / 2 : 0) + oy;
  return { positions, width, height, cols };
}
