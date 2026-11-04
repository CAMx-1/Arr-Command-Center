// Link Plex's duplicate files to the copy Sonarr/Radarr manages.
//
// Plex and the arr apps often see the same disk under different mount points
// (/media/movies in Plex, /data/movies in Radarr), so files are matched on the
// last two path parts (folder + file name), case-insensitive.
const tail = (p, n = 2) => String(p || '').replace(/\\/g, '/').split('/').filter(Boolean).slice(-n).join('/').toLowerCase();
// Folders compare on their last two parts (e.g. "movies2/dune part two (2024)"),
// so the same title folder on two drives isn't treated as one.
const folderTail = (p) => tail(p, 2);

// arrFiles: [{ service, item, file: fullPath }]
export function markManaged(plexItems, arrFiles) {
  const byTail = new Map();
  const byFolder = new Map();
  for (const f of arrFiles || []) {
    if (!f.file) continue;
    byTail.set(tail(f.file), f);
    const folder = String(f.file).replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    if (!byFolder.has(folderTail(folder))) byFolder.set(folderTail(folder), f);
  }
  return (plexItems || []).map((it) => {
    const parts = (it.parts || []).map((p) => {
      const exact = byTail.get(tail(p.file));
      return { ...p, managedBy: exact ? { service: exact.service, item: exact.item } : null };
    });
    // Any part in the managed item's folder but not its file (e.g. a second
    // version next to it) is "same folder"; anything else is elsewhere.
    const managed = parts.find((p) => p.managedBy);
    return {
      ...it,
      parts: parts.map((p) => ({ ...p, where: p.managedBy ? 'managed' : managed && folderTail(p.file.replace(/\\/g, '/').split('/').slice(0, -1).join('/')) === folderTail(managed.file.replace(/\\/g, '/').split('/').slice(0, -1).join('/')) ? 'same-folder' : 'other' })),
      managedService: managed ? managed.managedBy.service : null,
      managedItem: managed ? managed.managedBy.item : null,
    };
  });
}

// Folder names of every Plex duplicate part, to flag "Plex shows this" on
// copies the arr doesn't manage.
export function plexFolderSet(plexItems) {
  const s = new Set();
  for (const it of plexItems || []) for (const p of it.parts || []) s.add(folderTail(String(p.file).replace(/\\/g, '/').split('/').slice(0, -1).join('/')));
  return s;
}
export const folderKeyOf = (path) => folderTail(path);
