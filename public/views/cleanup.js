// Cleanup page (#/cleanup): titles taking disk space that nobody watches,
// from Sonarr/Radarr libraries joined with Tautulli watch history. Removing
// asks whether to delete files, then waits 5 seconds behind an Undo toast
// before anything is sent.
import { h, mount, spinner, empty, toast, fmtBytes, fmtRelative, poster, openModal, closeModal } from '../lib/ui.js';
import { cachedGet, invalidate } from '../lib/cache.js';
import { toastWithUndo } from '../lib/queueActions.js';
import { cleanupSuggestions, totalSize } from '../lib/cleanup.js';

const PREFS_KEY = 'acc:cleanup-prefs';
const readPrefs = () => { try { return { staleDays: 180, minAgeDays: 60, deleteFiles: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return { staleDays: 180, minAgeDays: 60, deleteFiles: true }; } };
const savePrefs = (p) => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ } };

async function loadData(ctx) {
  const arrs = ctx.state.services.filter((s) => (s.type === 'sonarr' || s.type === 'radarr') && s.configured !== false);
  const tau = ctx.state.services.find((s) => s.type === 'tautulli' && s.configured !== false);
  const libraries = await Promise.all(arrs.map(async (svc) => {
    const path = svc.type === 'sonarr' ? 'series' : 'movie';
    try { return { svc, items: await cachedGet(`arr:${svc.key}:${path}`, () => ctx.api.arr(svc.key).get(path), 300000) || [] }; }
    catch { return { svc, items: [], error: true }; }
  }));
  let history = [];
  let historyError = null;
  if (tau) {
    try {
      const d = await ctx.api.tautulli(tau.key).get('get_history', { length: 5000, order_column: 'date', order_dir: 'desc' });
      history = (d && d.data) || [];
    } catch (e) { historyError = e.message || 'Tautulli unavailable'; }
  }
  return { libraries, history, tau, historyError, arrs };
}

export async function renderCleanup(root, ctx) {
  ctx.setActions();
  mount(root, spinner());
  const prefs = readPrefs();
  const data = await loadData(ctx);
  if (!data.arrs.length) return mount(root, empty('', 'No Sonarr or Radarr yet', 'Add one in Settings to find space to free up'));
  if (!data.tau) return mount(root, empty('', 'Cleanup needs Tautulli', 'Add Tautulli in Settings so the app knows what has been watched'));
  if (data.historyError) return mount(root, empty('⚠️', 'Could not read watch history', data.historyError, { label: 'Retry', onClick: () => renderCleanup(root, ctx) }));

  const removed = new Set();
  const listEl = h('div', { class: 'list' });
  const summary = h('div', { class: 'cleanup-summary' });
  const sel = (label, key, options) => {
    const s = h('select', { class: 'input', 'aria-label': label, onchange: () => { prefs[key] = Number(s.value); savePrefs(prefs); paint(); } },
      ...options.map(([v, t]) => h('option', { value: v, selected: prefs[key] === v ? 'selected' : null }, t)));
    return h('label', { class: 'quick-add-field' }, h('span', { class: 'quick-add-label' }, label), s);
  };
  const kindSel = h('select', { class: 'input', 'aria-label': 'Show', onchange: () => paint() },
    h('option', { value: 'all' }, 'Movies and TV'), h('option', { value: 'movie' }, 'Movies'), h('option', { value: 'series' }, 'TV'));

  function paint() {
    const all = cleanupSuggestions(data.libraries, data.history, prefs).filter((s) => !removed.has(`${s.svc.key}:${s.item.id}`));
    const list = kindSel.value === 'all' ? all : all.filter((s) => s.kind === kindSel.value);
    mount(summary,
      h('div', { class: 'cleanup-total' }, fmtBytes(totalSize(list))),
      h('div', { class: 'dim' }, `could be freed across ${list.length} title${list.length === 1 ? '' : 's'}`));
    mount(listEl, ...(list.length ? list.slice(0, 200).map(row) : [empty('🧹', 'Nothing to clean up', 'Everything with files has been watched recently')]));
  }

  function row(s) {
    const img = (s.item.images || []).find((i) => i.coverType === 'poster');
    const why = s.reason === 'never'
      ? h('span', { class: 'pill warn' }, s.ageDays != null ? `Never watched · added ${fmtRelative(Date.now() - s.ageDays * 86400000)}` : 'Never watched')
      : h('span', { class: 'pill info' }, `Last watched ${fmtRelative(s.lastWatched)}`);
    const btn = h('button', { class: 'btn sm danger', type: 'button', onclick: () => confirmRemove(s) }, 'Remove…');
    return h('div', { class: 'row' },
      poster(img && (img.remoteUrl || img.url), ''),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, s.item.title, s.item.year ? h('span', { class: 'dim' }, ` (${s.item.year})`) : null),
        h('div', { class: 'meta-line', style: { marginTop: '4px' } },
          h('span', { class: 'pill muted' }, s.svc.label),
          h('strong', {}, fmtBytes(s.size)),
          why,
          s.plays ? h('span', { class: 'dim' }, `${s.plays} play${s.plays === 1 ? '' : 's'}${s.users.length ? ` · ${s.users.slice(0, 3).join(', ')}` : ''}`) : null)),
      h('div', { class: 'row-actions' }, btn));
  }

  function confirmRemove(s) {
    const del = h('input', { type: 'checkbox', checked: prefs.deleteFiles ? 'checked' : null });
    const excl = h('input', { type: 'checkbox' });
    openModal({
      title: `Remove “${s.item.title}”?`,
      body: h('div', { class: 'grid', style: { gap: '12px' } },
        h('p', { style: { margin: 0 } }, `Removes it from ${s.svc.label}. You'll have 5 seconds to undo.`),
        h('label', { class: 'cleanup-check' }, del, ` Also delete files from disk (${fmtBytes(s.size)})`),
        h('label', { class: 'cleanup-check' }, excl, ` Don't add it again from import lists`)),
      footer: h('div', { style: { display: 'flex', gap: '10px' } },
        h('button', { class: 'btn', type: 'button', onclick: closeModal }, 'Cancel'),
        h('button', { class: 'btn danger', type: 'button', onclick: () => {
          prefs.deleteFiles = del.checked; savePrefs(prefs);
          closeModal();
          queueRemoval(s, { deleteFiles: del.checked, exclude: excl.checked });
        } }, 'Remove')),
    });
  }

  function queueRemoval(s, { deleteFiles, exclude }) {
    const id = `${s.svc.key}:${s.item.id}`;
    removed.add(id); paint();
    toastWithUndo(`Removing ${s.item.title}${deleteFiles ? ` and ${fmtBytes(s.size)} of files` : ''}`, {
      onUndo: () => { removed.delete(id); paint(); },
      run: async () => {
        const path = `${s.kind}/${s.item.id}?deleteFiles=${deleteFiles}&${s.kind === 'movie' ? 'addImportExclusion' : 'addImportListExclusion'}=${exclude}`;
        try {
          await ctx.api.arr(s.svc.key).del(path);
          invalidate(`arr:${s.svc.key}:${s.kind}`);
          toast(`Removed ${s.item.title}${deleteFiles ? ` · freed ${fmtBytes(s.size)}` : ''}`, 'success');
        } catch (e) {
          removed.delete(id); paint();
          toast(e.message || `Couldn't remove ${s.item.title}`, 'error');
        }
      },
    });
  }

  mount(root,
    h('div', { class: 'card cleanup-card' },
      summary,
      h('div', { class: 'cleanup-filters' },
        sel('Not watched for', 'staleDays', [[90, '3 months'], [180, '6 months'], [365, '1 year'], [730, '2 years']]),
        sel('Ignore titles added in the last', 'minAgeDays', [[30, '30 days'], [60, '60 days'], [90, '90 days'], [180, '6 months']]),
        h('label', { class: 'quick-add-field' }, h('span', { class: 'quick-add-label' }, 'Show'), kindSel)),
      h('div', { class: 'dim', style: { fontSize: '12px' } }, `Based on ${data.history.length} plays from ${data.tau.label}. Largest first.`)),
    listEl);
  paint();
}
