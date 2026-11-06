// qBittorrent → "Seeding": choose a ratio and/or seeding time (and which
// categories or trackers), preview what would go, then remove. Rules are
// remembered per qBittorrent instance on this device.
import { h, mount, skeletonList, empty, toast, fmtBytes } from './ui.js';
import { planCleanup, options, deleteParams, DEFAULT_RULES } from './seedCleanup.js';
import { roleAllows } from './roleUi.js';

const KEY = (k) => `acc:seed-rules:${k}`;
const loadRules = (k) => { try { return { ...DEFAULT_RULES, ...JSON.parse(localStorage.getItem(KEY(k)) || '{}') }; } catch { return { ...DEFAULT_RULES }; } };
const saveRules = (k, r) => { try { localStorage.setItem(KEY(k), JSON.stringify(r)); } catch { /* ignore */ } };

export function tabSeeding(root, qb, ctx) {
  const key = ctx.service.key;
  let rules = loadRules(key);
  let torrents = [];
  const out = h('div', {});
  const canDelete = roleAllows('delete');
  const field = (label, el) => h('label', { style: { display: 'grid', gap: '4px', fontSize: '13px' } }, h('span', { class: 'dim' }, label), el);

  function render() {
    const opts = options(torrents);
    const plan = planCleanup(torrents, rules);
    const set = (patch) => { rules = { ...rules, ...patch }; saveRules(key, rules); render(); };
    const num = (k, step) => h('input', { class: 'input', type: 'number', min: '0', step, value: String(rules[k]), style: { width: '90px' }, onchange: (e) => set({ [k]: Math.max(0, Number(e.target.value) || 0) }) });
    const mode = h('select', { class: 'input', style: { width: 'auto' }, onchange: (e) => set({ mode: e.target.value }) },
      h('option', { value: 'either', selected: rules.mode === 'either' ? 'selected' : null }, 'either is reached'), h('option', { value: 'both', selected: rules.mode === 'both' ? 'selected' : null }, 'both are reached'));
    const chips = (list, sel, k, label) => h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } }, h('span', { class: 'dim', style: { fontSize: '13px' } }, label),
      h('button', { class: `btn sm ${sel.length ? '' : 'primary'}`, onclick: () => set({ [k]: [] }) }, 'All'),
      ...list.map((v) => h('button', { class: `btn sm ${sel.includes(v) ? 'primary' : ''}`, onclick: () => set({ [k]: sel.includes(v) ? sel.filter((x) => x !== v) : [...sel, v] }) }, v || '(none)')));
    const files = h('input', { type: 'checkbox', role: 'switch', checked: rules.deleteFiles ? 'checked' : null, onchange: (e) => set({ deleteFiles: e.target.checked }) });
    const go = canDelete && plan.remove.length ? h('button', { class: 'btn sm danger', onclick: async () => {
      if (go.dataset.armed !== '1') { go.dataset.armed = '1'; go.textContent = `Remove ${plan.remove.length}${rules.deleteFiles ? ' and delete files' : ''}?`; return; }
      go.disabled = true;
      try { await qb.post('torrents/delete', deleteParams(plan.remove.map((r) => r.hash), rules.deleteFiles)); toast(`Removed ${plan.remove.length} ${plan.remove.length === 1 ? 'torrent' : 'torrents'}${rules.deleteFiles ? ` and ${fmtBytes(plan.bytes)} of files` : ''}`, 'success', 5000); load(); }
      catch (e) { toast(e.message, 'error'); go.disabled = false; }
    } }, `Remove ${plan.remove.length}`) : null;
    const row = (r, kept) => h('div', { class: 'row', style: { padding: '6px 12px' } }, h('div', { class: 'row-main' },
      h('div', { class: 'row-title', style: { fontSize: '13px', wordBreak: 'break-all' } }, r.name),
      h('div', { class: 'meta-line', style: { fontSize: '12px' } }, h('span', {}, fmtBytes(r.size)), r.category ? h('span', { class: 'pill muted' }, r.category) : null, r.tracker ? h('span', { class: 'dim' }, r.tracker) : null,
        kept ? h('span', { class: 'dim' }, r.reason) : h('span', { class: 'pill warn' }, r.why.join(' · ')))));
    mount(out,
      h('div', { style: { display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '10px' } },
        field('Ratio at least', num('ratio', '0.1')), field('Seeded for days', num('days', '1')), field('Remove when', mode),
        h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '13px' } }, files, 'Also delete the files')),
      opts.categories.length > 1 ? chips(opts.categories, rules.categories, 'categories', 'Categories') : null,
      opts.trackers.length > 1 ? h('div', { style: { marginTop: '6px' } }, chips(opts.trackers, rules.trackers, 'trackers', 'Trackers')) : null,
      h('p', { class: 'dim', style: { fontSize: '12px' } }, `Torrents tagged “${rules.keepTag}” are always kept. Set a ratio or days to 0 to ignore it.${rules.deleteFiles ? ' Sonarr and Radarr normally hard-link or copy torrents when they import them, so the library copy stays. Check yours aren’t set to move files before using this.' : ''}`),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', margin: '6px 0' } }, h('div', { class: 'section-title', style: { margin: '0', flex: '1' } }, `Would remove ${plan.remove.length} (${fmtBytes(plan.bytes)})`), go),
      plan.remove.length ? h('div', { class: 'list' }, ...plan.remove.map((r) => row(r, false))) : h('div', { class: 'dim' }, 'Nothing has reached these limits yet.'),
      plan.keep.length ? h('details', { style: { marginTop: '12px' } }, h('summary', { class: 'dim', style: { cursor: 'pointer' } }, `Keeping ${plan.keep.length}`), h('div', { class: 'list', style: { marginTop: '8px' } }, ...plan.keep.map((r) => row(r, true)))) : null);
  }
  async function load() {
    mount(out, skeletonList(3));
    try { torrents = await qb.get('torrents/info?filter=completed'); render(); }
    catch (e) { mount(out, empty('', 'Couldn’t read torrents', e.message)); }
  }
  mount(root, out);
  load();
}
