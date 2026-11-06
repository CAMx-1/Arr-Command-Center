// Settings → Activity log (admins): who changed what, with filters and CSV.
import { h, mount, toast, fmtRelative, debounce } from './ui.js';
import { api } from './api.js';
import { toCsv, downloadCsv, stamp } from './csv.js';

const LEVEL = { delete: 'down', admin: 'warn', write: 'info' };

export function activityCard() {
  const card = h('div', { class: 'card', id: 'activity-panel' });
  const userSel = h('select', { class: 'input', style: { width: 'auto' }, 'aria-label': 'User' }, h('option', { value: '' }, 'Everyone'));
  const svcSel = h('select', { class: 'input', style: { width: 'auto' }, 'aria-label': 'Service' }, h('option', { value: '' }, 'All services'));
  const q = h('input', { class: 'input', placeholder: 'Search', style: { flex: '1', minWidth: '120px' } });
  const list = h('div', {});
  let all = []; let shown = 50;

  const render = () => {
    const rows = all.filter((e) => (!userSel.value || e.user === userSel.value) && (!svcSel.value || (e.service || 'acc') === svcSel.value) && (!q.value || `${e.action} ${e.serviceLabel} ${e.user}`.toLowerCase().includes(q.value.toLowerCase())));
    mount(list,
      rows.length ? h('div', { class: 'list' }, ...rows.slice(0, shown).map((e) => h('div', { class: 'row', style: { padding: '6px 10px' } },
        h('div', { class: 'row-main' },
          h('div', { style: { fontSize: '13px' } }, h('b', {}, e.user), ' ', e.action, ' ', h('span', { class: 'dim' }, `in ${e.serviceLabel}`)),
          h('div', { class: 'meta-line', style: { fontSize: '11px' } },
            h('span', { class: `pill ${LEVEL[e.level] || 'muted'}` }, e.level), h('span', { class: 'dim' }, e.role),
            e.status >= 400 ? h('span', { class: 'pill down' }, e.status === 403 ? 'refused' : `failed (${e.status})`) : null,
            h('span', { class: 'dim', title: new Date(e.at).toLocaleString() }, fmtRelative(e.at))))))) : h('div', { class: 'dim' }, all.length ? 'Nothing matches.' : 'Nothing logged yet. Changes, deletes, requests and restarts show up here.'),
      rows.length > shown ? h('button', { class: 'btn sm', style: { marginTop: '8px' }, onclick: () => { shown += 100; render(); } }, `Show more (${rows.length - shown})`) : null);
  };
  const load = async () => {
    try { all = await api.getJson('/api/activity?limit=1000'); } catch (e) { mount(list, h('div', { class: 'dim' }, e.message)); return; }
    const opt = (sel, values) => { const cur = sel.value; mount(sel, sel.firstChild, ...values.map(([v, l]) => h('option', { value: v }, l))); sel.value = cur; };
    opt(userSel, [...new Set(all.map((e) => e.user))].sort().map((u) => [u, u]));
    opt(svcSel, [...new Map(all.map((e) => [e.service || 'acc', e.serviceLabel])).entries()].sort((a, b) => a[1].localeCompare(b[1])));
    render();
  };
  [userSel, svcSel].forEach((s) => s.addEventListener('change', render));
  q.addEventListener('input', debounce(render, 200));
  mount(card,
    h('div', { class: 'dim', style: { fontSize: '13px', marginBottom: '8px' } }, 'Every change, delete, request, restart and refused attempt, newest first (last 1,000). Only what was done is kept, never request contents or keys.'),
    h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' } }, userSel, svcSel, q,
      h('button', { class: 'btn sm', onclick: load }, '↻'),
      h('button', { class: 'btn sm', onclick: () => downloadCsv(`activity-${stamp()}.csv`, toCsv(['Time', 'User', 'Role', 'Service', 'Action', 'Level', 'Status'], all.map((e) => [e.at, e.user, e.role, e.serviceLabel, e.action, e.level, e.status]))) }, 'Export CSV')),
    list);
  load();
  return card;
}
