// Settings → Backups card (admins): back up every *arr app at once and
// download the zips each app keeps.
import { h, mount, toast, fmtBytes, fmtRelative, spinner } from './ui.js';
import { api } from './api.js';
import { isLocalMode } from './connections.js';
import { backupTargets, backUpAll, listBackups, runBackup, backupPageUrl } from './backups.js';

const proxy = (key, path, opts) => api.proxy(key, path, opts);

export function backupsCard(ctx) {
  const card = h('div', { class: 'card', id: 'backups-panel' });
  const targets = backupTargets(ctx.state.services);
  if (!targets.length) { mount(card, h('div', { class: 'dim' }, 'No Sonarr, Radarr, Lidarr, Readarr, Whisparr or Prowlarr connected.')); return card; }
  const rows = new Map();
  const state = new Map(targets.map((s) => [s.key, { status: 'loading', backups: [] }]));

  const paintRow = (svc) => {
    const st = state.get(svc.key);
    const latest = st.backups[0];
    const openBtn = h('a', { class: 'btn sm', href: backupPageUrl(svc.key), target: '_blank', rel: 'noopener', title: `Download backups from ${svc.label}’s System → Backup page` }, `Open in ${svc.label}`);
    const one = h('button', { class: 'btn sm', disabled: st.status === 'running' ? 'disabled' : null, onclick: () => runOne(svc) }, 'Back up');
    const canOpen = !isLocalMode();
    const more = st.backups.length > 1 ? h('details', { style: { fontSize: '12px', marginTop: '4px' } }, h('summary', { class: 'dim', style: { cursor: 'pointer' } }, `${st.backups.length - 1} older`),
      ...st.backups.slice(1, 10).map((b) => h('div', { class: 'dim', style: { margin: '4px 0' } }, `${b.type} · ${fmtRelative(b.time)} · ${fmtBytes(b.size)}`))) : null;
    mount(rows.get(svc.key),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title', style: { fontSize: '13px' } }, svc.label, ' ',
          st.status === 'running' ? h('span', { class: 'pill info' }, 'backing up…') : st.status === 'done' ? h('span', { class: 'pill ok' }, 'backed up') : st.status === 'error' ? h('span', { class: 'pill down' }, 'failed') : null),
        h('div', { class: 'dim', style: { fontSize: '12px' } }, st.status === 'error' ? st.error : st.status === 'loading' ? 'Reading backups…' : latest ? `Latest: ${latest.type}, ${fmtRelative(latest.time)}, ${fmtBytes(latest.size)}` : 'No backups yet'),
        more),
      h('div', { class: 'row-actions' }, one, canOpen ? openBtn : null));
  };

  async function refresh(svc) {
    try { state.set(svc.key, { ...state.get(svc.key), status: state.get(svc.key).status === 'loading' ? 'idle' : state.get(svc.key).status, backups: await listBackups(proxy, svc) }); }
    catch (e) { state.set(svc.key, { status: 'error', error: e.message, backups: [] }); }
    paintRow(svc);
  }
  async function runOne(svc) {
    state.set(svc.key, { ...state.get(svc.key), status: 'running' }); paintRow(svc);
    try { const r = await runBackup(proxy, svc); state.set(svc.key, { status: 'done', backups: r.backups }); }
    catch (e) { state.set(svc.key, { ...state.get(svc.key), status: 'error', error: e.message }); }
    paintRow(svc);
  }
  const allBtn = h('button', { class: 'btn primary sm', onclick: async () => {
    allBtn.disabled = true;
    for (const s of targets) { state.set(s.key, { ...state.get(s.key), status: 'running' }); paintRow(s); }
    const res = await backUpAll(proxy, targets, { onResult: (r) => { state.set(r.svc.key, r.ok ? { status: 'done', backups: r.backups } : { ...state.get(r.svc.key), status: 'error', error: r.error }); paintRow(r.svc); } });
    const bad = res.filter((r) => !r.ok).length;
    toast(bad ? `Backed up ${res.length - bad} of ${res.length} apps` : `Backed up all ${res.length} apps`, bad ? 'warn' : 'success', 5000);
    allBtn.disabled = false;
  } }, `Back up all (${targets.length})`);

  mount(card,
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' } },
      h('div', { class: 'dim', style: { fontSize: '13px', flex: '1' } }, 'Runs each app’s own Backup and lists the zips it keeps. To download one, open the app’s Backup page (the apps only hand backup files to their own login). Backups hold the app’s API key and the passwords for your indexers and download clients, so keep them somewhere safe.'),
      allBtn),
    h('div', { class: 'list' }, ...targets.map((svc) => { const r = h('div', { class: 'row', style: { alignItems: 'flex-start' } }, spinner()); rows.set(svc.key, r); return r; })));
  targets.forEach((s) => { paintRow(s); refresh(s); });
  return card;
}
