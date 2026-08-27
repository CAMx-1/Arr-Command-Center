// Reusable library filter control for Sonarr (series) and Radarr (movie)
// libraries. Renders a title search box + a status dropdown and calls
// onChange(filteredItems) whenever either changes.
import { h } from './ui.js';

// Status filter definitions per media kind. `test(item)` returns true when the
// item should be shown for that option.
const FILTERS = {
  series: [
    { id: 'all', label: 'All', test: () => true },
    { id: 'monitored', label: 'Monitored', test: (s) => !!s.monitored },
    { id: 'unmonitored', label: 'Unmonitored', test: (s) => !s.monitored },
    { id: 'missing', label: 'Missing', test: (s) => {
      const st = s.statistics || {}; return (st.episodeFileCount || 0) < (st.episodeCount || 0);
    } },
    { id: 'complete', label: 'Complete', test: (s) => {
      const st = s.statistics || {}; return (st.episodeCount || 0) > 0 && (st.episodeFileCount || 0) >= (st.episodeCount || 0);
    } },
    { id: 'continuing', label: 'Continuing', test: (s) => s.status === 'continuing' },
    { id: 'ended', label: 'Ended', test: (s) => s.status === 'ended' },
  ],
  movie: [
    { id: 'all', label: 'All', test: () => true },
    { id: 'monitored', label: 'Monitored', test: (m) => !!m.monitored },
    { id: 'unmonitored', label: 'Unmonitored', test: (m) => !m.monitored },
    { id: 'downloaded', label: 'Downloaded', test: (m) => !!m.hasFile },
    { id: 'missing', label: 'Missing', test: (m) => !m.hasFile },
  ],
};

// Build the filter bar. `kind` is 'series' or 'movie'. `items` is the full list.
// `onChange` receives the filtered subset whenever the search text or status
// selection changes. Returns the control element to place in the lib-head.
export function libraryFilter(kind, items, onChange) {
  const defs = FILTERS[kind] || FILTERS.movie;
  let statusId = 'all';
  let term = '';

  const apply = () => {
    const def = defs.find((d) => d.id === statusId) || defs[0];
    const t = term.trim().toLowerCase();
    const filtered = items.filter((it) => def.test(it) && (!t || String(it.title || '').toLowerCase().includes(t)));
    onChange(filtered);
  };

  const search = h('input', { class: 'input lib-filter-search', type: 'search', placeholder: 'Filter by title…' });
  search.addEventListener('input', () => { term = search.value; apply(); });

  const sel = h('select', { class: 'input lib-filter-select' }, ...defs.map((d) => h('option', { value: d.id }, d.label)));
  sel.addEventListener('change', () => { statusId = sel.value; apply(); });

  return h('div', { class: 'lib-filter' }, search, sel);
}
