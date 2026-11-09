// Plex → "Missing from Plex": titles Sonarr/Radarr have imported that Plex
// doesn't show, and shows where Plex has fewer episodes than Sonarr has
// files. "Scan this folder" asks Plex to look at just that folder.
import { h, mount, skeletonList, empty, toast, fmtRelative } from './ui.js';
import { api } from './api.js';
import { roleAllows } from './roleUi.js';

const label = (t, y) => `${t}${y ? ` (${y})` : ''}`;
const RECENT_MS = 30 * 60000;

export function tabMissingFromPlex(root) {
  const load = async (quiet = false) => {
    if (!quiet) mount(root, skeletonList(3));
    let d;
    try { d = await api.getJson('/api/plex/missing'); } catch (e) { mount(root, empty('', 'Couldn’t compare with Plex', e.message)); return; }
    const total = d.missing.length + d.episodes.length;
    if (!total) { mount(root, empty('✓', 'Nothing missing', `All ${d.compared} titles Sonarr and Radarr have files for are in Plex.`)); return; }
    const canScan = roleAllows('write');
    const scan = async (btn, it) => {
      btn.disabled = true;
      try {
        await api.sendJson('/api/plex/scan', { section: it.sectionKey, path: it.plexPath || null });
        toast(it.plexPath ? `Plex is scanning ${it.plexPath}` : `Plex is scanning the ${it.sectionTitle} library`, 'success', 4000);
        btn.textContent = 'Scanning…';
        // Plex scans in the background; look again shortly.
        setTimeout(() => { if (root.isConnected) load(true); }, 2500);
      } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
    };
    const row = (it, detail) => {
      const recent = it.added && Date.now() - Date.parse(it.added) < RECENT_MS;
      const btn = canScan && it.sectionKey ? h('button', { class: 'btn sm primary', title: it.plexPath ? `Scan ${it.plexPath} in the ${it.sectionTitle} library` : `Plex sees the disks at another path, so the whole ${it.sectionTitle} library is scanned`, onclick: () => scan(btn, it) }, it.plexPath ? 'Scan this folder' : `Scan ${it.sectionTitle}`) : null;
      return h('div', { class: 'row', style: { alignItems: 'flex-start' } },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', style: { fontSize: '14px' } }, label(it.title, it.year), ' ', h('span', { class: 'pill muted' }, it.serviceLabel),
            recent ? h('span', { class: 'pill info', style: { marginLeft: '4px' } }, `imported ${fmtRelative(it.added)}`) : null),
          detail ? h('div', { style: { fontSize: '12px' } }, detail) : null,
          h('div', { class: 'mono dim', style: { fontSize: '11px', wordBreak: 'break-all' } }, it.path)),
        h('div', { class: 'row-actions' }, btn, h('a', { class: 'btn sm', href: `#/${encodeURIComponent(it.serviceKey)}?q=${encodeURIComponent(it.title)}` }, `Open in ${it.serviceLabel}`)));
    };
    // Titles whose root folder has nothing in Plex and isn't a Plex library
    // folder: most likely no library includes that folder.
    const placed = d.missing.filter((it) => it.plexPath);
    const groups = new Map();
    for (const it of d.missing.filter((x) => !x.plexPath)) {
      const k = `${it.serviceKey}|${it.rootFolderPath || ''}`;
      if (!groups.has(k)) groups.set(k, { ...it, items: [] });
      groups.get(k).items.push(it);
    }
    const scanAll = canScan && (placed.length + d.episodes.length) ? h('button', { class: 'btn sm', onclick: async () => {
      scanAll.disabled = true;
      const jobs = new Map();
      for (const it of [...placed, ...d.episodes]) if (it.sectionKey) jobs.set(`${it.sectionKey}|${it.plexPath}`, it);
      let ok = 0;
      for (const it of jobs.values()) { try { await api.sendJson('/api/plex/scan', { section: it.sectionKey, path: it.plexPath || null }); ok += 1; } catch { /* counted below */ } }
      toast(`Asked Plex to scan ${ok} of ${jobs.size} ${jobs.size === 1 ? 'folder' : 'folders'}`, ok === jobs.size ? 'success' : 'warn');
      setTimeout(() => { if (root.isConnected) load(true); }, 2500);
    } }, 'Scan them all') : null;
    const groupRow = (g) => {
      const btn = canScan && g.sectionKey ? h('button', { class: 'btn sm', title: `For when Plex sees ${g.rootFolderPath} under another path`, onclick: () => scan(btn, g) }, `Scan ${g.sectionTitle}`) : null;
      const kind = g.kind === 'movie' ? (g.items.length === 1 ? 'film' : 'films') : (g.items.length === 1 ? 'show' : 'shows');
      return h('div', { class: 'row', style: { alignItems: 'flex-start' } },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', style: { fontSize: '14px' } }, h('span', { class: 'mono' }, g.rootFolderPath || '(unknown folder)'), ' ', h('span', { class: 'pill muted' }, g.serviceLabel), ' ', h('span', { class: 'pill warn' }, `${g.items.length} ${kind}`)),
          h('div', { class: 'dim', style: { fontSize: '12px' } }, g.items.slice(0, 6).map((x) => label(x.title, x.year)).join(', ') + (g.items.length > 6 ? `, and ${g.items.length - 6} more` : '')),
          h('div', { style: { fontSize: '12px', marginTop: '4px' } }, 'Nothing from this folder is in Plex. Add it to a Plex library (in Plex: the library’s ⋯ → Edit → Add folders). If Plex already has it under another path, scan the library.')),
        btn ? h('div', { class: 'row-actions' }, btn) : null);
    };
    mount(root,
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' } },
        h('p', { class: 'dim', style: { fontSize: '13px', margin: '0', flex: '1' } }, `${total} of ${d.compared} titles with files in Sonarr/Radarr aren’t fully in Plex. Usually Plex hasn’t scanned that folder yet, or the folder isn’t in a Plex library.`),
        scanAll, h('button', { class: 'btn sm', onclick: () => load() }, 'Check again')),
      placed.length ? h('div', { class: 'section-title' }, `Not in Plex (${placed.length})`) : null,
      placed.length ? h('div', { class: 'list' }, ...placed.map((it) => row(it, null))) : null,
      groups.size ? h('div', { class: 'section-title', style: { marginTop: '14px' } }, `Folders no Plex library seems to include (${groups.size})`) : null,
      groups.size ? h('div', { class: 'list' }, ...[...groups.values()].map(groupRow)) : null,
      d.episodes.length ? h('div', { class: 'section-title', style: { marginTop: '14px' } }, `Missing episodes (${d.episodes.length})`) : null,
      d.episodes.length ? h('div', { class: 'list' }, ...d.episodes.map((it) => row(it, `Plex has ${it.plexEpisodes} ${it.plexEpisodes === 1 ? 'episode' : 'episodes'}; Sonarr has ${it.files} ${it.files === 1 ? 'file' : 'files'}.`))) : null);
  };
  load();
}
