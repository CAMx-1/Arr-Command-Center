// Reusable library filter control for Sonarr (series), Radarr (movie) and
// Readarr/Chaptarr (author) libraries. Renders a search box + a status
// dropdown and calls onChange(filteredItems) whenever either changes.
import { h } from './ui.js';
import { dismissKeyboardOnEnter } from './nativeApp.js';

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
  author: [
    { id: 'all', label: 'All', test: () => true },
    { id: 'monitored', label: 'Monitored', test: (a) => !!a.monitored },
    { id: 'unmonitored', label: 'Unmonitored', test: (a) => !a.monitored },
    { id: 'files', label: 'With files', test: (a) => ((a.statistics || {}).bookFileCount || 0) > 0 },
    { id: 'nofiles', label: 'No files', test: (a) => !((a.statistics || {}).bookFileCount > 0) },
    { id: 'continuing', label: 'Continuing', test: (a) => a.status === 'continuing' },
    { id: 'ended', label: 'Ended', test: (a) => a.status === 'ended' },
  ],
};
// What the search box matches, and its hint, per kind.
const NAME_OF = { author: (a) => a.authorName };
const PLACEHOLDER = { author: 'Filter by name…' };

// Build the filter bar. `kind` is 'series', 'movie' or 'author'. `items` is the full list.
// `onChange` receives the filtered subset whenever the search text or status
// selection changes. `opts.initialTerm` pre-fills the search box (used by the
// global search "Open" deep-link, via the ?q= route param). Returns the control element for the lib-head.
export function libraryFilter(kind, items, onChange, { initialTerm = '', initialStatus = 'all', onStateChange = null } = {}) {
  const defs = FILTERS[kind] || FILTERS.movie;
  let statusId = defs.some((d) => d.id === initialStatus) ? initialStatus : 'all';
  let term = initialTerm || '';

  const apply = () => {
    const def = defs.find((d) => d.id === statusId) || defs[0];
    const t = term.trim().toLowerCase();
    const nameOf = NAME_OF[kind] || ((it) => it.title);
    const filtered = items.filter((it) => def.test(it) && (!t || String(nameOf(it) || '').toLowerCase().includes(t)));
    onChange(filtered);
  };

  const search = h('input', { class: 'input lib-filter-search', type: 'search', enterkeyhint: 'search', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', placeholder: PLACEHOLDER[kind] || 'Filter by title…', value: term });
  search.addEventListener('input', () => { term = search.value; apply(); if (onStateChange) onStateChange({ term, status: statusId }); });
  dismissKeyboardOnEnter(search); // results already filter live; Search/Return just closes the keyboard

  const sel = h('select', { class: 'input lib-filter-select' }, ...defs.map((d) => h('option', { value: d.id, selected: d.id === statusId }, d.label)));
  sel.value = statusId;
  sel.addEventListener('change', () => { statusId = sel.value; apply(); if (onStateChange) onStateChange({ term, status: statusId }); });

  // Initial render (respects any pre-filled term).
  apply();

  return h('div', { class: 'lib-filter' }, search, sel);
}

