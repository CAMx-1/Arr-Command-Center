// Plex → "Wrong matches": Plex titles whose TMDB/TVDB id differs from the
// Sonarr/Radarr entry in the same folder, with Plex's own Fix Match search.
import { h, mount, skeletonList, empty, toast, openModal, closeModal, spinner } from './ui.js';
import { api } from './api.js';
import { roleAllows } from './roleUi.js';

const label = (t, y) => `${t}${y ? ` (${y})` : ''}`;

async function openFix(it, reload) {
  const body = h('div', {}, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, spinner(), h('span', { class: 'dim' }, 'Asking Plex for matches…')));
  openModal({ title: `Fix match — ${label(it.plexTitle, it.plexYear)}`, body });
  let list;
  try { list = await api.getJson(`/api/plex/matches/${encodeURIComponent(it.ratingKey)}?title=${encodeURIComponent(it.arr.title)}&year=${encodeURIComponent(it.arr.year || '')}`); }
  catch (e) { mount(body, empty('', 'Plex didn’t return matches', e.message)); return; }
  const best = list.find((c) => String(c.year) === String(it.arr.year) && c.name.toLowerCase() === it.arr.title.toLowerCase());
  mount(body,
    h('p', { class: 'dim', style: { fontSize: '13px', margin: '0 0 10px' } }, `${it.arr.serviceLabel} has this folder as ${label(it.arr.title, it.arr.year)}. Pick the right one:`),
    list.length ? h('div', { class: 'list' }, ...list.map((c) => h('div', { class: 'row', style: { padding: '8px 12px' } },
      h('div', { class: 'row-main' }, h('div', { class: 'row-title', style: { fontSize: '13px' } }, label(c.name, c.year), ' ', c === best ? h('span', { class: 'pill ok' }, `matches ${it.arr.serviceLabel}`) : null), h('div', { class: 'dim', style: { fontSize: '11px' } }, `Plex score ${c.score ?? '—'}`)),
      h('div', { class: 'row-actions' }, h('button', { class: `btn sm ${c === best ? 'primary' : ''}`, onclick: async (e) => {
        e.target.disabled = true;
        try { await api.sendJson(`/api/plex/match/${encodeURIComponent(it.ratingKey)}`, { guid: c.guid, name: c.name, year: c.year }); toast(`Plex now has it as ${label(c.name, c.year)}; refreshing its details`, 'success', 5000); closeModal(); reload(); }
        catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
      } }, 'Use this'))))) : empty('', 'No matches found', 'Try fixing it in Plex itself (⋯ → Fix Match).'));
}

export function tabWrongMatches(root) {
  const load = async () => {
    mount(root, skeletonList(3));
    let d;
    try { d = await api.getJson('/api/plex/mismatches'); } catch (e) { mount(root, empty('', 'Couldn’t compare with Plex', e.message)); return; }
    if (!d.items.length && !d.compared && d.checked) { mount(root, empty('', 'Nothing to compare', `None of the ${d.checked} Plex titles are in a folder that Sonarr or Radarr has. They’re matched by folder name, so Plex and the apps need to use the same folder names.`)); return; }
    if (!d.items.length) { mount(root, empty('✓', 'No wrong matches', `All ${d.compared} Plex titles that live in a Sonarr/Radarr folder agree with it.`)); return; }
    const admin = roleAllows('admin');
    mount(root, h('p', { class: 'dim', style: { fontSize: '13px' } }, `${d.items.length} of ${d.compared} Plex titles don’t match what Sonarr/Radarr have in the same folder. Plex shows the wrong poster, description and watch history for these.`),
      h('div', { class: 'list' }, ...d.items.map((it) => h('div', { class: 'row', style: { alignItems: 'flex-start' } },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', style: { fontSize: '14px' } }, 'Plex: ', label(it.plexTitle, it.plexYear), ' ', h('span', { class: 'pill warn' }, it.plexId ? `${it.idType.toUpperCase()} ${it.plexId}` : `no ${it.idType.toUpperCase()} id`)),
          h('div', { style: { fontSize: '12px' } }, `${it.arr.serviceLabel}: `, h('b', {}, label(it.arr.title, it.arr.year)), h('span', { class: 'dim' }, ` · ${it.idType.toUpperCase()} ${it.arr.expectedId}`)),
          h('div', { class: 'mono dim', style: { fontSize: '11px', wordBreak: 'break-all' } }, it.folder)),
        admin ? h('div', { class: 'row-actions' }, h('button', { class: 'btn sm primary', onclick: () => openFix(it, load) }, 'Fix match')) : null))));
  };
  load();
}
