// Calendar page (#/calendar): a month grid of Sonarr/Radarr releases with the
// coming week listed below it. Tapping a date with releases opens the same day
// popup as the Overview's Upcoming calendar. Pinnable to the mobile bottom bar.
import { h, mount, spinner, empty, toast } from '../lib/ui.js';
import { isServicePinned, setServicePinned, CALENDAR_PIN } from '../lib/servicePrefs.js';
import { monthFor, fetchRange } from '../lib/calendarRange.js';
import { fetchUpcomingItems, renderUpcomingCalendar, upcomingListBlocks, upcomingInstanceChips } from './home.js';

// Month offset is kept for the session so Back from a day's service lands on
// the same month.
let monthOffset = 0;

export async function renderCalendar(root, ctx) {
  const pinBtn = () => {
    const pinned = isServicePinned(CALENDAR_PIN);
    return h('button', {
      class: 'btn sm', type: 'button',
      title: pinned ? 'Remove Calendar from the mobile bottom bar' : 'Add Calendar to the mobile bottom bar',
      onclick: () => {
        const r = setServicePinned(CALENDAR_PIN, !pinned);
        const removed = r.removed && ctx.state.services.find((s) => s.key === r.removed);
        toast(r.pinned ? `Calendar added to the bottom bar${removed ? ` (replaced ${removed.label})` : ''}` : 'Calendar removed from the bottom bar', 'success');
        ctx.reload();
      },
    }, pinned ? '★ In bottom bar' : '☆ Add to bottom bar');
  };
  ctx.setActions(pinBtn());

  const monthLabel = h('h3', { class: 'cal-month-label', 'aria-live': 'polite' });
  const prev = h('button', { class: 'btn sm cal-nav', type: 'button', 'aria-label': 'Previous month', onclick: () => { monthOffset -= 1; load(); } }, '‹');
  const next = h('button', { class: 'btn sm cal-nav', type: 'button', 'aria-label': 'Next month', onclick: () => { monthOffset += 1; load(); } }, '›');
  const todayBtn = h('button', { class: 'btn sm', type: 'button', onclick: () => { monthOffset = 0; load(); } }, 'Today');
  const grid = h('div', { class: 'cal-grid-panel' });
  const week = h('div', { class: 'cal-week-panel' });
  const chips = upcomingInstanceChips(ctx, () => load());

  mount(root,
    h('div', { class: 'card cal-card' },
      h('div', { class: 'cal-head' }, prev, monthLabel, next, todayBtn),
      chips,
      grid),
    h('div', { class: 'section-title' }, 'Next 7 days'),
    week);

  let run = 0;
  async function load() {
    const id = ++run;
    const today = new Date();
    const shown = monthFor(today, monthOffset);
    monthLabel.textContent = new Date(shown.year, shown.month, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
    todayBtn.disabled = monthOffset === 0;
    mount(grid, spinner());
    if (!week.childElementCount) mount(week, spinner());
    const range = fetchRange(today, shown);
    let items = [];
    try { items = await fetchUpcomingItems(ctx, range.start, range.end); } catch { items = []; }
    if (id !== run) return;
    renderUpcomingCalendar(grid, items, { ...shown, today });
    const coming = items.filter((it) => { const t = new Date(it.when); return t >= range.weekStart && t < range.weekEnd; });
    mount(week, coming.length
      ? h('div', { class: 'list dashboard-feed-list' }, ...upcomingListBlocks(coming))
      : empty('', 'Nothing in the next 7 days', 'New episodes and movie releases will show up here'));
  }

  if (!ctx.state.services.some((s) => (s.type === 'sonarr' || s.type === 'radarr') && s.configured)) {
    mount(root, empty('', 'No Sonarr or Radarr yet', 'Add one in Settings to see upcoming releases here'));
    return;
  }
  await load();
}
