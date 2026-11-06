// Seerr "Never watched" tab: requests that have been available for a while
// but the person who asked hasn't played (per Tautulli).
import { h, mount, skeletonList, empty, toast, fmtBytes, fmtRelative } from './ui.js';
import { api } from './api.js';
import { loadNeverWatched, arrActionRequests } from './neverWatched.js';
import { roleAllows } from './roleUi.js';
import { toCsv, downloadCsv, stamp } from './csv.js';

const DAYS_KEY = 'acc-neverwatched-days';
const STATUS = { never: ['Nobody watched', 'down'], others: ['Others watched', 'warn'], unknown: ['Can’t check', 'muted'] };

export async function tabNeverWatched(root, seerr, ctx) {
  const services = ctx.state.services || [];
  const tau = services.find((s) => s.type === 'tautulli' && s.configured !== false);
  const arrs = services.filter((s) => (s.type === 'radarr' || s.type === 'sonarr') && s.configured !== false)
    .map((s) => ({ serviceKey: s.key, label: s.label, kind: s.type === 'sonarr' ? 'tv' : 'movie', arr: api.arr(s.key) }));
  let minDays = Number(localStorage.getItem(DAYS_KEY)) || 90;
  let showOthers = true;
  let data = null;
  const out = h('div', {});
  const daysSel = h('select', { class: 'input', style: { width: 'auto' }, 'aria-label': 'Available for at least' },
    ...[30, 60, 90, 180, 365].map((d) => h('option', { value: String(d), selected: d === minDays ? 'selected' : null }, `Available ${d}+ days`)));
  daysSel.addEventListener('change', () => { minDays = Number(daysSel.value); localStorage.setItem(DAYS_KEY, String(minDays)); load(); });

  async function act(row, match, action, btn) {
    btn.disabled = true;
    try {
      const rq = arrActionRequests(match, action);
      await api.proxy(match.serviceKey, `api/v3/${rq.path}`, { method: rq.method, body: rq.body });
      // After deleting, clear it in Seerr too so it shows as requestable again.
      if (action === 'delete' && row.mediaId) await seerr.del(`media/${row.mediaId}`).catch(() => {});
      toast(action === 'delete' ? `Deleted ${row.title} from ${match.label}` : `Stopped monitoring ${row.title} in ${match.label}`, 'success');
      btn.textContent = action === 'delete' ? 'Deleted' : 'Unmonitored';
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
  }

  function render() {
    const rows = data.rows.filter((r) => showOthers || r.status !== 'others');
    const counts = { never: 0, others: 0, unknown: 0 };
    for (const r of data.rows) counts[r.status] += 1;
    const total = data.rows.filter((r) => r.status !== 'unknown').reduce((s, r) => s + r.size, 0);
    mount(out,
      !data.hasTautulli ? h('p', { class: 'dim' }, 'Add Tautulli to check who has watched what. Without it every request shows as “can’t check”.') : null,
      h('div', { class: 'meta-line', style: { margin: '6px 0 10px', flexWrap: 'wrap' } },
        h('span', { class: 'pill down' }, `${counts.never} nobody watched`), h('span', { class: 'pill warn' }, `${counts.others} only others watched`),
        counts.unknown ? h('span', { class: 'pill muted' }, `${counts.unknown} can’t check`) : null,
        total ? h('span', { class: 'dim' }, `${fmtBytes(total)} on disk`) : null,
        h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '13px' } },
          h('input', { type: 'checkbox', role: 'switch', checked: showOthers ? 'checked' : null, onchange: (e) => { showOthers = e.target.checked; render(); } }), 'Include ones others watched'),
        h('button', { class: 'btn sm', style: { marginLeft: 'auto' }, onclick: () => downloadCsv(`never-watched-${stamp()}.csv`, toCsv(['Title', 'Type', 'Requested by', 'Requested', 'Available since', 'Status', 'Watched by', 'Size'], data.rows.map((r) => [r.title, r.type, r.requestedBy, r.requestedAt, r.addedAt, STATUS[r.status][0], r.watchers.join(' '), r.size]))) }, 'Export CSV')),
      rows.length ? h('div', { class: 'list' }, ...rows.map((r) => {
        const [label, cls] = STATUS[r.status];
        const actions = [];
        for (const m of r.matches) {
          if (roleAllows('write') && m.monitored !== false) { const b = h('button', { class: 'btn sm', onclick: () => act(r, m, 'unmonitor', b) }, r.matches.length > 1 ? `Unmonitor (${m.label})` : 'Unmonitor'); actions.push(b); }
          if (roleAllows('delete')) {
            let armed = false;
            const b = h('button', { class: 'btn sm danger', title: `Delete from ${m.label} with its files`, onclick: () => {
              if (!armed) { armed = true; b.textContent = 'Delete files too?'; setTimeout(() => { if (armed && !b.disabled) { armed = false; b.textContent = 'Delete'; } }, 5000); return; }
              act(r, m, 'delete', b);
            } }, r.matches.length > 1 ? `Delete (${m.label})` : 'Delete');
            actions.push(b);
          }
        }
        return h('div', { class: 'row', style: { alignItems: 'flex-start' } },
          h('div', { class: 'row-main' },
            h('div', { class: 'row-title', style: { fontSize: '13px' } }, `${r.title}${r.year ? ` (${r.year})` : ''}`, ' ', h('span', { class: `pill ${cls}` }, label)),
            h('div', { class: 'meta-line', style: { fontSize: '12px' } },
              h('span', {}, `Requested by ${r.requestedBy}`),
              h('span', { class: 'dim' }, `available ${r.daysAvailable} days`),
              r.size ? h('span', { class: 'dim' }, fmtBytes(r.size)) : null,
              r.watchers.length ? h('span', { class: 'dim' }, `watched by ${r.watchers.join(', ')}${r.lastPlayed ? `, last ${fmtRelative(r.lastPlayed)}` : ''}`) : null,
              !r.matches.length ? h('span', { class: 'dim' }, 'not found in Sonarr/Radarr') : null)),
          actions.length ? h('div', { class: 'row-actions', style: { flexWrap: 'wrap', justifyContent: 'flex-end' } }, ...actions) : null);
      })) : empty('✓', 'Nothing to tidy up', `Every request available for ${minDays}+ days has been watched by the person who asked.`),
      h('p', { class: 'dim', style: { fontSize: '12px', marginTop: '10px' } }, 'Matches Seerr to Tautulli by Plex rating key. Delete removes the title and its files from Sonarr/Radarr and clears it in Seerr so it can be requested again.'));
  }

  async function load() {
    mount(out, skeletonList(4));
    try { data = await loadNeverWatched({ seerr, tautulli: tau ? api.tautulli(tau.key) : null, arrs, minDays }); render(); }
    catch (e) { mount(out, empty('', 'Couldn’t load requests', e.message)); }
  }
  mount(root, h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, h('span', { class: 'dim', style: { fontSize: '13px' } }, 'Requests that are available but the requester hasn’t watched'), h('span', { style: { flex: '1' } }), daysSel), out);
  load();
}
