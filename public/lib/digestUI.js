// Settings → Weekly digest (admins): schedule, preview and send now.
import { h, mount, toast } from './ui.js';
import { api } from './api.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function digestCard() {
  const card = h('div', { class: 'card', id: 'digest-panel' }, h('div', { class: 'dim' }, 'Loading…'));
  const load = async () => {
    let d;
    try { d = await api.getJson('/api/digest?preview=1'); } catch (e) { mount(card, h('div', { class: 'dim' }, e.message)); return; }
    const s = d.settings;
    const enabled = h('input', { type: 'checkbox', role: 'switch', checked: s.enabled ? 'checked' : null });
    const day = h('select', { class: 'input', style: { width: 'auto' } }, ...DAYS.map((n, i) => h('option', { value: String(i), selected: i === s.day ? 'selected' : null }, n)));
    const hour = h('select', { class: 'input', style: { width: 'auto' } }, ...Array.from({ length: 24 }, (_, i) => h('option', { value: String(i), selected: i === s.hour ? 'selected' : null }, `${String(i).padStart(2, '0')}:00`)));
    const days = h('select', { class: 'input', style: { width: 'auto' } }, ...[7, 14, 30].map((n) => h('option', { value: String(n), selected: n === s.days ? 'selected' : null }, `last ${n} days`)));
    const save = async () => { try { await api.sendJson('/api/digest', { enabled: enabled.checked, day: Number(day.value), hour: Number(hour.value), days: Number(days.value) }, 'PUT'); toast('Digest settings saved', 'success'); load(); } catch (e) { toast(e.message, 'error'); } };
    [enabled, day, hour, days].forEach((el) => el.addEventListener('change', save));
    const sendBtn = h('button', { class: 'btn sm', onclick: async () => {
      sendBtn.disabled = true;
      try {
        const r = await api.sendJson('/api/digest/send', {});
        const ch = (r.result && r.result.channels) || {};
        const missing = (r.errors || []).length ? ` Left out: ${r.errors.map((e) => `${e.service} (${e.error})`).join(', ')}.` : '';
        toast(`${ch.results && ch.results.length ? `Digest sent to ${ch.sent} of ${ch.results.length} channels${ch.failed ? ` (${ch.failed} failed)` : ''}` : 'Digest sent (no channels take the digest category; push only)'}.${missing}`, ch.failed || missing ? 'warn' : 'success', 8000);
        load();
      } catch (e) { toast(e.message, 'error'); }
      sendBtn.disabled = false;
    } }, 'Send now');
    const p = d.preview || {};
    mount(card,
      h('div', { class: 'dim', style: { fontSize: '13px', marginBottom: '8px' } }, 'A weekly list of what Sonarr and Radarr imported, sent to your notification channels and push (category “Weekly digest”). Weeks with nothing new are skipped.'),
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
        h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, enabled, 'Send every'), day, h('span', {}, 'at'), hour, h('span', {}, 'covering the'), days, h('span', { style: { flex: '1' } }), sendBtn),
      s.lastSent ? h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '6px' } }, `Last sent ${new Date(s.lastSent).toLocaleString()}`) : null,
      h('div', { class: 'section-title', style: { margin: '12px 0 6px' } }, 'Preview'),
      (p.errors || []).length ? h('div', { class: 'pill warn', style: { margin: '0 0 6px', display: 'inline-block' } }, `Couldn’t read ${p.errors.map((e) => `${e.service}: it ${e.error}`).join('; ')}. ${p.errors.length >= p.sources ? 'Nothing will be sent until it can be read.' : 'A scheduled digest waits and retries until every app can be read.'}`) : null,
      (p.log || []).length ? h('details', { style: { margin: '0 0 8px', fontSize: '12px' }, open: (p.errors || []).length ? 'open' : null },
        h('summary', { class: 'dim', style: { cursor: 'pointer' } }, `Details (${p.log.length} requests)`),
        h('div', { class: 'mono', style: { fontSize: '11px', marginTop: '4px', display: 'grid', gap: '2px' } }, ...p.log.map((l) => h('div', { style: { wordBreak: 'break-all' } },
          l.note ? h('span', { class: 'pill info', style: { marginRight: '6px' } }, 'note') : h('span', { class: `pill ${l.ok ? 'ok' : 'down'}`, style: { marginRight: '6px' } }, l.ok ? `${l.ms} ms` : 'failed'),
          l.note ? `${l.service}: ${l.note}` : `${l.service} GET ${l.path}`,
          l.note ? '' : l.ok ? (l.records != null ? ` → ${l.records} rows${l.total != null ? ` of ${l.total}` : ''}${l.newest ? `, ${l.oldest.slice(0, 10)} to ${l.newest.slice(0, 10)}, ${l.inRange} in range` : ''}` : ' → ok') : ` → ${l.error}${l.status ? ` (HTTP ${l.status})` : ''}${l.code ? ` [${l.code}]` : ''} after ${l.ms} ms`))),
        h('button', { class: 'btn sm', style: { marginTop: '6px' }, onclick: () => navigator.clipboard.writeText(p.log.map((l) => JSON.stringify(l)).join('\n')).then(() => toast('Copied', 'success')) }, 'Copy details')) : null,
      p.error ? h('div', { class: 'dim' }, p.error) : h('div', { style: { fontSize: '13px' } }, h('b', {}, p.title || ''), h('pre', { style: { whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: '6px 0 0', fontSize: '12px' } }, p.body || '')));
  };
  load();
  return card;
}
