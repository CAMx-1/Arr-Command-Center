// Settings → Services → "Check compatibility": which of the newer tools will
// work with the versions you run, from read-only calls to each service.
import { h, mount, spinner, empty, fmtRelative } from './ui.js';
import { api } from './api.js';

const LAST_KEY = 'acc:compat-last';
const STATUS = { ready: ['ok', 'Ready'], partly: ['warn', 'Partly'], no: ['down', 'Won’t work'], unknown: ['muted', 'Can’t tell yet'], off: ['muted', 'Not set up'] };
const MARK = (ok) => (ok === true ? ['ok', '✓'] : ok === 'partly' ? ['warn', '~'] : ok === null ? ['muted', '?'] : ['down', '✕']);
const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };

export function lastCompatSummary() {
  const last = read(LAST_KEY);
  if (!last) return '';
  return `${last.ready} of ${last.used} tools ready · checked ${fmtRelative(new Date(last.at).toISOString())}`;
}

export function compatCard() {
  const card = h('div', { class: 'card', id: 'compat-panel' });
  const results = h('div', {});
  const run = async (btn) => {
    if (btn) btn.disabled = true;
    mount(results, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px' } }, spinner(), h('span', { class: 'dim' }, 'Asking each service…')));
    let d;
    try { d = await api.getJson('/api/compat'); }
    catch (e) { mount(results, empty('', 'Couldn’t run the check', e.message)); if (btn) btn.disabled = false; return; }
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ at: d.at, ready: d.counts.ready, used: d.counts.used })); } catch { /* storage off */ }
    card.dispatchEvent(new CustomEvent('sx:refresh', { bubbles: true }));
    if (btn) { btn.disabled = false; btn.textContent = 'Check again'; }
    const toolRow = (t) => {
      const [cls, word] = STATUS[t.status] || STATUS.unknown;
      const problems = t.items.filter((i) => i.ok !== true);
      const body = h('div', { style: { display: 'grid', gap: '3px', marginTop: '6px' } },
        ...t.items.map((i) => { const [c, m] = MARK(i.ok); return h('div', { style: { fontSize: '12px', display: 'flex', gap: '6px', alignItems: 'baseline' } }, h('span', { class: `pill ${c}`, style: { minWidth: '22px', textAlign: 'center' } }, m), h('b', {}, i.label), h('span', { class: 'dim' }, i.note)); }),
        ...t.needs.map((n) => h('div', { class: 'dim', style: { fontSize: '12px' } }, `Also uses ${n}.`)));
      const details = h('details', { open: problems.length || t.needs.length ? 'open' : null }, h('summary', { style: { cursor: 'pointer', listStyle: 'none' } },
        h('span', { class: 'row-title', style: { fontSize: '14px' } }, t.name), ' ', h('span', { class: `pill ${cls}` }, word), ' ', h('span', { class: 'dim', style: { fontSize: '12px' } }, t.where)), t.items.length ? body : h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '4px' } }, 'None of the services it uses are set up.'));
      return h('div', { class: 'row', style: { display: 'block' } }, details);
    };
    const order = { no: 0, partly: 1, unknown: 2, ready: 3, off: 4 };
    const tools = d.tools.slice().sort((a, b) => order[a.status] - order[b.status]);
    mount(results,
      h('p', { style: { fontSize: '13px', margin: '12px 0 8px' } }, h('b', {}, `${d.counts.ready} of ${d.counts.used} tools ready`), h('span', { class: 'dim' }, ` with the ${d.services.length} services checked.`)),
      h('div', { class: 'list' }, ...tools.map(toolRow)),
      h('div', { class: 'section-title', style: { marginTop: '14px' } }, 'Versions'),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '4px 14px', fontSize: '13px' } },
        ...d.services.map((s) => h('div', {}, h('b', {}, s.label), ' ', s.reachable ? h('span', { class: 'dim' }, s.version || 'version unknown') : h('span', { style: { color: 'var(--red)' } }, `not reachable: ${s.error}`)))));
  };
  const btn = h('button', { class: 'btn sm primary', onclick: () => run(btn) }, 'Check my services');
  mount(card,
    h('p', { class: 'dim settings-copy' }, 'Asks each service for its version and tries, read-only, the API calls the newer tools rely on: Radarr collections, Tautulli stream details, Bazarr’s wanted lists, Plex ids and sharing, Playback Reporting, webhooks, download client settings. Nothing is changed, searched or sent.'),
    btn, results);
  return card;
}
