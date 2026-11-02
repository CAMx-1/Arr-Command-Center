// Collapse same-day season drops in upcoming lists and calendars.
//
// Streaming services often release a whole season at once, which would show
// as ten or more identical rows. Episodes of the same series and season that
// air on the same local day (same instance) become one item, e.g.
// "Show · S02E01–E10" with the sub-line "10 episodes". Items without episode
// data (movies) pass through unchanged.

export const COLLAPSE_MIN = 3;
const pad2 = (n) => String(n ?? 0).padStart(2, '0');

export function dayKey(when) {
  const d = new Date(when);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Contiguous runs of episode numbers, e.g. [1,2,3,5] -> "E01–E03, E05".
export function episodeRangeLabel(numbers) {
  const nums = [...new Set(numbers.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < nums.length; i += 1) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j += 1;
    parts.push(i === j ? `E${pad2(nums[i])}` : `E${pad2(nums[i])}–E${pad2(nums[j])}`);
    i = j;
  }
  return parts.join(', ');
}

export function collapseSeasonDrops(items, { min = COLLAPSE_MIN } = {}) {
  const groups = new Map();
  const out = [];
  for (const it of items) {
    const ep = it && it.episode;
    if (!ep || ep.seriesId == null || ep.seasonNumber == null) { out.push(it); continue; }
    const key = `${it.svc && it.svc.key}|${ep.seriesId}|${ep.seasonNumber}|${dayKey(it.when)}`;
    if (!groups.has(key)) { groups.set(key, []); out.push({ __group: key }); }
    groups.get(key).push(it);
  }
  return out.flatMap((entry) => {
    if (!entry.__group) return [entry];
    const list = groups.get(entry.__group);
    if (list.length < min) return list;
    list.sort((a, b) => a.episode.episodeNumber - b.episode.episodeNumber);
    const first = list[0];
    const series = first.episode.seriesTitle || first.filterTitle || 'Unknown';
    const nums = list.map((x) => x.episode.episodeNumber);
    const whole = nums.includes(1) ? ' · new season' : '';
    return [{
      ...first,
      when: list.reduce((m, x) => (new Date(x.when) < new Date(m) ? x.when : m), first.when),
      title: `${series} · S${pad2(first.episode.seasonNumber)}${episodeRangeLabel(nums)}`,
      sub: `${list.length} episodes${whole}`,
      collapsed: list,
    }];
  });
}
