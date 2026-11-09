// "Wrong matches": media-server titles whose TMDB/TVDB id differs from the
// Sonarr/Radarr entry in the same folder, with the server's own match search
// to fix one. Used by the Plex page and the Jellyfin/Emby pages.
import { h, mount, skeletonList, empty, toast, openModal, closeModal, spinner } from './ui.js';
import { api } from './api.js';
import { roleAllows } from './roleUi.js';

const label = (t, y) => `${t}${y ? ` (${y})` : ''}`;
const enc = encodeURIComponent;

// Where the list, candidates and fix come from.
const PLEX = {
  name: 'Plex',
  list: () => api.getJson('/api/plex/mismatches'),
  candidates: async (it) => (await api.getJson(`/api/plex/matches/${enc(it.ratingKey)}?title=${enc(it.arr.title)}&year=${enc(it.arr.year || '')}`)).map((c) => ({
    name: c.name, year: c.year, detail: `Plex score ${c.score ?? '—'}`,
    matchesArr: String(c.year) === String(it.arr.year) && String(c.name).toLowerCase() === String(it.arr.title).toLowerCase(),
    apply: () => api.sendJson(`/api/plex/match/${enc(it.ratingKey)}`, { guid: c.guid, name: c.name, year: c.year }),
  })),
  fixHint: 'Try fixing it in Plex itself (⋯ → Fix Match).',
};

export function mediaServerSource(svc) {
  const base = `/api/media/${enc(svc.key)}`;
  return {
    name: svc.label,
    list: () => api.getJson(`${base}/mismatches`),
    candidates: async (it) => (await api.getJson(`${base}/matches/${enc(it.ratingKey)}?kind=${it.type}&title=${enc(it.arr.title)}&year=${enc(it.arr.year || '')}&idType=${it.idType}&id=${enc(it.arr.expectedId)}`)).map((c) => ({
      name: c.name, year: c.year, detail: [c.provider, ...Object.entries(c.ids || {}).filter(([k]) => ['tmdb', 'tvdb', 'imdb'].includes(k)).map(([k, v]) => `${k.toUpperCase()} ${v}`)].filter(Boolean).join(' · '),
      matchesArr: c.matchesArr, apply: () => api.sendJson(`${base}/match/${enc(it.ratingKey)}`, { result: c.result }),
    })),
    fixHint: `Try Identify in ${svc.label} itself (the title’s ⋯ menu → Identify).`,
  };
}

async function openFix(src, it, reload) {
  const body = h('div', {}, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, spinner(), h('span', { class: 'dim' }, `Asking ${src.name} for matches…`)));
  openModal({ title: `Fix match — ${label(it.plexTitle, it.plexYear)}`, body });
  let list;
  try { list = await src.candidates(it); } catch (e) { mount(body, empty('', `${src.name} didn’t return matches`, e.message)); return; }
  const best = list.find((c) => c.matchesArr);
  mount(body,
    h('p', { class: 'dim', style: { fontSize: '13px', margin: '0 0 10px' } }, `${it.arr.serviceLabel} has this folder as ${label(it.arr.title, it.arr.year)}. Pick the right one:`),
    list.length ? h('div', { class: 'list' }, ...list.map((c) => h('div', { class: 'row', style: { padding: '8px 12px' } },
      h('div', { class: 'row-main' }, h('div', { class: 'row-title', style: { fontSize: '13px' } }, label(c.name, c.year), ' ', c === best ? h('span', { class: 'pill ok' }, `matches ${it.arr.serviceLabel}`) : null), h('div', { class: 'dim', style: { fontSize: '11px' } }, c.detail)),
      h('div', { class: 'row-actions' }, h('button', { class: `btn sm ${c === best ? 'primary' : ''}`, onclick: async (e) => {
        e.target.disabled = true;
        try { await c.apply(); toast(`${src.name} now has it as ${label(c.name, c.year)}; refreshing its details`, 'success', 5000); closeModal(); reload(); }
        catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
      } }, 'Use this'))))) : empty('', 'No matches found', src.fixHint));
}

export function wrongMatchesTab(root, src) {
  const load = async () => {
    mount(root, skeletonList(3));
    let d;
    try { d = await src.list(); } catch (e) { mount(root, empty('', `Couldn’t compare with ${src.name}`, e.message)); return; }
    if (!d.items.length && !d.compared && d.checked) { mount(root, empty('', 'Nothing to compare', `None of the ${d.checked} ${src.name} titles are in a folder that Sonarr or Radarr has. They’re matched by folder name, so ${src.name} and the apps need to use the same folder names.`)); return; }
    if (!d.items.length) { mount(root, empty('✓', 'No wrong matches', `All ${d.compared} ${src.name} titles that live in a Sonarr/Radarr folder agree with it.`)); return; }
    const admin = roleAllows('admin');
    mount(root, h('p', { class: 'dim', style: { fontSize: '13px' } }, `${d.items.length} of ${d.compared} ${src.name} titles don’t match what Sonarr/Radarr have in the same folder. ${src.name} shows the wrong poster, description and watch history for these.`),
      h('div', { class: 'list' }, ...d.items.map((it) => h('div', { class: 'row', style: { alignItems: 'flex-start' } },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', style: { fontSize: '14px' } }, `${src.name}: `, label(it.plexTitle, it.plexYear), ' ', h('span', { class: 'pill warn' }, it.plexId ? `${it.idType.toUpperCase()} ${it.plexId}` : `no ${it.idType.toUpperCase()} id`)),
          h('div', { style: { fontSize: '12px' } }, `${it.arr.serviceLabel}: `, h('b', {}, label(it.arr.title, it.arr.year)), h('span', { class: 'dim' }, ` · ${it.idType.toUpperCase()} ${it.arr.expectedId}`)),
          h('div', { class: 'mono dim', style: { fontSize: '11px', wordBreak: 'break-all' } }, it.folder)),
        admin ? h('div', { class: 'row-actions' }, h('button', { class: 'btn sm primary', onclick: () => openFix(src, it, load) }, 'Fix match')) : null))));
  };
  load();
}

export function tabWrongMatches(root) { wrongMatchesTab(root, PLEX); }
