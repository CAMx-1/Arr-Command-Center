// Setup doctor: Settings → Services → "Setup doctor" (all apps) and a
// System-tab button (one app). Findings can be ignored on this device.
import { h, mount, spinner, empty, toast, fmtRelative, openModal } from './ui.js';
import { api } from './api.js';

const LAST_KEY = 'acc:doctor-last';
const IGNORE_KEY = 'acc:doctor-ignored';
const SEV = { problem: ['down', 'Problem'], warning: ['warn', 'Warning'], info: ['muted', 'Note'] };
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage off */ } };

export function lastDoctorSummary() {
  const last = read(LAST_KEY, null);
  if (!last) return '';
  const c = last.counts || {};
  const parts = [c.problem ? `${c.problem} ${c.problem === 1 ? 'problem' : 'problems'}` : null, c.warning ? `${c.warning} ${c.warning === 1 ? 'warning' : 'warnings'}` : null].filter(Boolean);
  return `${parts.join(', ') || 'No problems'} · checked ${fmtRelative(new Date(last.at).toISOString())}`;
}

function findingRow(f, labels, onIgnore) {
  const [cls, word] = SEV[f.severity] || SEV.info;
  const link = f.link ? h('a', { class: 'btn sm', href: f.link.href, ...(/^https?:/.test(f.link.href) ? { target: '_blank', rel: 'noopener noreferrer' } : {}) }, f.link.label) : null;
  return h('div', { class: `row doctor-finding severity-${f.severity}`, style: { alignItems: 'flex-start' } },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title', style: { fontSize: '14px' } }, h('span', { class: `pill ${cls}`, style: { marginRight: '6px' } }, word), f.title),
      f.detail ? h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '3px' } }, f.detail) : null,
      h('div', { style: { fontSize: '13px', marginTop: '4px' } }, h('b', {}, 'Fix: '), f.fix),
      h('div', { class: 'meta-line', style: { fontSize: '11px', marginTop: '4px' } }, h('span', { class: 'dim' }, f.area), ...f.services.map((k) => h('span', { class: 'pill muted' }, labels[k] || k)))),
    h('div', { class: 'row-actions', style: { flexWrap: 'wrap' } }, link, onIgnore ? h('button', { class: 'btn sm', title: 'Hide this on this device until you restore it', onclick: onIgnore }, 'Ignore') : null));
}

// The doctor's results, all apps or one (service key).
function doctorView(ctx, { service = null } = {}) {
  const box = h('div', {});
  const labels = Object.fromEntries((ctx.state.services || []).map((s) => [s.key, s.label]));
  let data = null;
  const render = () => {
    const ignored = new Set(read(IGNORE_KEY, []));
    const mine = data.findings.filter((f) => !service || f.services.includes(service));
    const shown = mine.filter((f) => !ignored.has(f.id)); const hidden = mine.filter((f) => ignored.has(f.id));
    const ignore = (f) => () => { write(IGNORE_KEY, [...ignored, f.id]); render(); };
    const restore = (f) => () => { write(IGNORE_KEY, [...ignored].filter((x) => x !== f.id)); render(); };
    const count = (sev) => shown.filter((f) => f.severity === sev).length;
    const checked = service ? (labels[service] || service) : `${data.checked.apps.length} ${data.checked.apps.length === 1 ? 'app' : 'apps'}${data.checked.clients.length ? `, ${data.checked.clients.map((c) => c.label).join(', ')}` : ''}${data.checked.prowlarr ? ' and Prowlarr' : ''}`;
    mount(box,
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', margin: '0 0 10px' } },
        h('div', { style: { flex: '1', minWidth: '220px', fontSize: '13px' } },
          h('b', {}, shown.length ? [count('problem') && `${count('problem')} ${count('problem') === 1 ? 'problem' : 'problems'}`, count('warning') && `${count('warning')} ${count('warning') === 1 ? 'warning' : 'warnings'}`, count('info') && `${count('info')} ${count('info') === 1 ? 'note' : 'notes'}`].filter(Boolean).join(', ') : 'Nothing found'),
          h('span', { class: 'dim' }, ` · checked ${checked} ${fmtRelative(new Date(data.at).toISOString())}`)),
        h('button', { class: 'btn sm', onclick: () => run() }, 'Check again')),
      ...data.errors.map((e) => h('p', { class: 'dim', style: { fontSize: '12px', margin: '0 0 4px' } }, `Couldn’t read ${e}`)),
      shown.length ? h('div', { class: 'list' }, ...shown.map((f) => findingRow(f, labels, ignore(f))))
        : empty('✓', service ? `Nothing wrong found for ${labels[service] || service}` : 'Nothing wrong found', 'Root folders, download clients and folders, categories, hard links and Prowlarr sync all look right.'),
      hidden.length ? h('details', { style: { marginTop: '10px' } }, h('summary', { class: 'dim', style: { cursor: 'pointer' } }, `Ignored (${hidden.length})`),
        h('div', { class: 'list', style: { marginTop: '6px' } }, ...hidden.map((f) => h('div', { class: 'row', style: { padding: '6px 12px' } }, h('div', { class: 'row-main' }, h('div', { class: 'row-title', style: { fontSize: '13px' } }, f.title)),
          h('div', { class: 'row-actions' }, h('button', { class: 'btn sm', onclick: restore(f) }, 'Restore')))))) : null,
      h('p', { class: 'dim', style: { fontSize: '12px', marginTop: '10px' } }, 'Read-only: the doctor looks at settings, folder listings and download lists, and changes nothing. Download folders are checked for qBittorrent and SABnzbd.'));
  };
  async function run() {
    mount(box, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, spinner(), h('span', { class: 'dim' }, 'Checking the apps, download clients and Prowlarr…')));
    try { data = await api.getJson('/api/doctor'); }
    catch (e) { mount(box, empty('', 'Couldn’t run the checks', e.message, { label: 'Try again', onClick: () => run() })); return; }
    if (!service) { write(LAST_KEY, { at: data.at, counts: data.counts }); box.dispatchEvent(new CustomEvent('sx:refresh', { bubbles: true })); }
    render();
  }
  return { box, run };
}

// Settings card: checks run when it's opened (or on Check again).
export function doctorCard(ctx) {
  const card = h('div', { class: 'card', id: 'doctor-panel' });
  const v = doctorView(ctx);
  const start = h('button', { class: 'btn sm primary', onclick: () => { mount(card, v.box); v.run(); } }, 'Run the checks');
  mount(card,
    h('p', { class: 'dim settings-copy' }, 'Read-only checks for the setup mistakes that quietly stop imports: root folders an app can’t reach, download folders it can’t see (remote path mappings), torrents on another disk than the library (no hard links), download client categories, and indexers missing from Prowlarr’s sync. Each comes with a plain fix.'),
    start);
  return card;
}

export function openSetupDoctor(ctx, { service = null } = {}) {
  const v = doctorView(ctx, { service });
  openModal({ title: service ? `Setup doctor — ${(ctx.state.services || []).find((s) => s.key === service)?.label || service}` : 'Setup doctor', body: v.box, wide: true });
  v.run();
}
