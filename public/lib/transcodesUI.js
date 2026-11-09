// Tautulli → "Transcodes": titles that rarely direct-play, why, and what to do.
import { h, mount, skeletonList, empty, toast } from './ui.js';
import { api } from './api.js';
import { loadTranscodes, matchLibrary } from './transcodes.js';
import { roleAllows } from './roleUi.js';

export const REPLACE_TAG = 'transcodes';

async function tagForReplacement(m) {
  const arr = api.arr(m.serviceKey);
  const tags = await arr.get('tag');
  let tag = (tags || []).find((t) => String(t.label).toLowerCase() === REPLACE_TAG);
  if (!tag) tag = await arr.post('tag', { label: REPLACE_TAG });
  const body = m.kind === 'movie' ? { movieIds: [m.item.id], tags: [tag.id], applyTags: 'add' } : { seriesIds: [m.item.id], tags: [tag.id], applyTags: 'add' };
  await arr.put(m.kind === 'movie' ? 'movie/editor' : 'series/editor', body);
}

export function tabTranscodes(root, tau, ctx) {
  transcodesTab(root, ctx, { source: 'Tautulli', load: (days) => loadTranscodes(tau, { days }), noDetails: 'Tautulli didn’t keep stream details for these plays.' });
}

// The same list for Jellyfin/Emby, from the Playback Reporting plugin.
export function tabMediaTranscodes(root, ctx) {
  const key = encodeURIComponent(ctx.service.key);
  transcodesTab(root, ctx, { source: 'Playback Reporting', load: (days) => api.getJson(`/api/media/${key}/transcodes?days=${days}`), noDetails: 'Playback Reporting recorded no details for these plays.' });
}

function transcodesTab(root, ctx, { source, load: loadData, noDetails }) {
  let days = 30;
  const sel = h('select', { class: 'input', style: { width: 'auto' }, 'aria-label': 'Period' }, ...[[7, 'Last week'], [30, 'Last 30 days'], [90, 'Last 90 days']].map(([d, l]) => h('option', { value: String(d), selected: d === days ? 'selected' : null }, l)));
  const out = h('div', {});
  sel.addEventListener('change', () => { days = Number(sel.value); load(); });
  mount(root, h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } }, h('span', { class: 'dim', style: { flex: '1', fontSize: '13px' } }, 'Titles that converted on most plays, and why. Transcoding uses server CPU and can buffer.'), sel), out);
  async function load() {
    mount(out, skeletonList(3));
    const arrs = (ctx.state.services || []).filter((s) => (s.type === 'radarr' || s.type === 'sonarr') && s.configured !== false);
    let data; let libs;
    try {
      [data, libs] = await Promise.all([
        loadData(days),
        Promise.all(arrs.map(async (s) => ({ serviceKey: s.key, label: s.label, kind: s.type === 'radarr' ? 'movie' : 'show', items: await api.arr(s.key).get(s.type === 'radarr' ? 'movie' : 'series').catch(() => []) }))),
      ]);
    } catch (e) { mount(out, empty('', `Couldn’t read ${source}’s play history`, e.message)); return; }
    if (!data.groups.length) { mount(out, empty('✓', 'Nothing keeps transcoding', `Across ${data.plays} plays in the last ${days} days, every title mostly direct-played.`)); return; }
    mount(out, h('div', { class: 'list' }, ...data.groups.map((g) => {
      const m = matchLibrary(g, libs);
      const tagBtn = m && roleAllows('write') ? h('button', { class: 'btn sm', title: `Add the “${REPLACE_TAG}” tag in ${m.label} so you can find these later`, onclick: async () => { tagBtn.disabled = true; try { await tagForReplacement(m); toast(`Tagged ${g.title} “${REPLACE_TAG}” in ${m.label}`, 'success'); tagBtn.textContent = 'Tagged'; } catch (e) { toast(e.message, 'error'); tagBtn.disabled = false; } } }, 'Tag for replacement') : null;
      const heavy = (g.reasons || []).filter((r) => !r.light);
      return h('div', { class: 'row', style: { alignItems: 'flex-start' } },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', style: { fontSize: '14px' } }, `${g.title}${g.year ? ` (${g.year})` : ''}`, ' ', h('span', { class: `pill ${g.share === 100 ? 'down' : 'warn'}` }, `${g.transcodes} of ${g.plays} plays transcoded`), g.kind === 'show' ? h('span', { class: 'pill muted', style: { marginLeft: '4px' } }, 'TV') : null),
          g.players.length ? h('div', { class: 'dim', style: { fontSize: '12px' } }, `On ${g.players.join(', ')}`) : null,
          ...(g.reasons || []).map((r) => h('div', { style: { fontSize: '12px', marginTop: '4px' } }, h('b', {}, `${r.text}. `), h('span', { class: 'dim' }, r.fix))),
          !(g.reasons || []).length ? h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '4px' } }, noDetails) : null,
          heavy.length === 0 && (g.reasons || []).length ? h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '4px' } }, 'Only light conversion: probably fine to leave.') : null),
        h('div', { class: 'row-actions', style: { flexWrap: 'wrap' } },
          m ? h('a', { class: 'btn sm', href: `#/${encodeURIComponent(m.serviceKey)}?q=${encodeURIComponent(g.title)}` }, `Open in ${m.label}`) : null, tagBtn));
    })));
  }
  load();
}
