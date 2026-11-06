// "Tidy up" dialog (System tab).
import { h, mount, spinner, empty, toast, openModal } from './ui.js';
import { loadTidyUp, fixRequest } from './tidyUp.js';
import { roleAllows } from './roleUi.js';

const nameOf = (it) => `${it.title}${it.year ? ` (${it.year})` : ''}`;

export async function openTidyUp(arr, ctx, kind) {
  const body = h('div', {});
  openModal({ title: `Tidy up — ${ctx.service.label}`, body, wide: true });
  const load = async () => {
    mount(body, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, spinner(), h('span', { class: 'dim' }, 'Checking the library…')));
    let data;
    try { data = await loadTidyUp(arr, kind); } catch (e) { mount(body, empty('', 'Couldn’t check the library', e.message)); return; }
    if (!data.groups.length) { mount(body, empty('✓', 'Nothing to tidy up', `All ${data.total} entries look fine.`)); return; }
    mount(body, h('p', { class: 'dim', style: { margin: '0 0 10px', fontSize: '13px' } }, `${new Set(data.groups.flatMap((g) => g.items.map((i) => i.id))).size} of ${data.total} entries could be tidied (some appear under more than one heading). Tick the ones to fix.`),
      ...data.groups.map((g) => group(g, data)));
  };
  function group(g, data) {
    const sel = new Set(g.items.map((i) => i.id));
    const count = h('span', { class: 'dim' });
    const paint = () => { count.textContent = `${sel.size} selected`; };
    const rows = g.items.map((it) => {
      const cb = h('input', { type: 'checkbox', checked: 'checked', 'aria-label': `Select ${nameOf(it)}`, onchange: (e) => { if (e.target.checked) sel.add(it.id); else sel.delete(it.id); paint(); } });
      return h('label', { class: 'row', style: { padding: '6px 12px', gap: '10px', cursor: 'pointer' } }, cb, h('div', { class: 'row-main' }, h('div', { class: 'row-title', style: { fontSize: '13px' } }, nameOf(it)),
        h('div', { class: 'dim', style: { fontSize: '11px' } }, g.id === 'no-root' ? it.rootFolderPath : g.id === 'ended-complete' ? `${(it.statistics || {}).episodeFileCount} episodes` : it.path || '')));
    });
    const run = async (rule, btn, extra) => {
      if (!sel.size) return;
      btn.disabled = true;
      try { const r = fixRequest(kind, rule, [...sel], extra); await ctx.api.proxy(ctx.service.key, `api/v3/${r.path}`, { method: r.method, body: r.body }); toast(`${g.title}: fixed ${sel.size}`, 'success'); load(); }
      catch (e) { toast(e.message, 'error'); btn.disabled = false; }
    };
    let action = null;
    if (g.fix === 'unmonitor' && roleAllows('write')) { const b = h('button', { class: 'btn sm primary', onclick: () => run('unmonitor', b) }, 'Unmonitor selected'); action = b; }
    if (g.fix === 'delete' && roleAllows('delete')) {
      const b = h('button', { class: 'btn sm danger', onclick: () => { if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Remove entries? (files kept)'; return; } run('delete', b); } }, 'Remove selected entries');
      action = b;
    }
    if (g.fix === 'profile' && roleAllows('write')) {
      const pick = h('select', { class: 'input', style: { width: 'auto' } }, ...data.profiles.map((p) => h('option', { value: String(p.id) }, p.name)));
      const b = h('button', { class: 'btn sm primary', onclick: () => run('profile', b, { profileId: pick.value }) }, 'Set profile');
      action = h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, pick, b);
    }
    if (g.fix === 'paths') action = h('a', { class: 'btn sm', href: `#/${encodeURIComponent(ctx.service.key)}?tab=system&tool=fixpaths` }, 'Open Fix paths');
    paint();
    return h('div', { style: { margin: '0 0 16px' } },
      h('div', { class: 'section-title', style: { margin: '8px 0 4px' } }, `${g.title} (${g.items.length})`),
      h('p', { class: 'dim', style: { fontSize: '12px', margin: '0 0 6px' } }, g.why),
      h('div', { class: 'list', style: { maxHeight: '30vh', overflowY: 'auto' } }, ...rows),
      h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'flex-end', marginTop: '8px' } }, g.fix !== 'paths' ? count : null, action));
  }
  load();
}
