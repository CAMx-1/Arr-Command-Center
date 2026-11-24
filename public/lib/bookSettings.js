// Pure helpers for a book manager's folders (Chaptarr, legacy Readarr): root
// folders, remote path mappings, and the check that each download client's
// folder is one the app can reach. The UI is lib/bookFoldersUI.js.
//
// A remote path mapping turns the path a download client reports (its own
// view, e.g. /Volumes/12-1/Completed-AudioBooks/) into the path the app sees
// (e.g. /data/12-1/Completed-AudioBooks/ inside its container). Chaptarr
// compares remote paths case-sensitively, as Linux does, even when the
// drive itself ignores case.

import { MONITOR_OPTIONS, NEW_ITEM_OPTIONS } from './readarrLibrary.js';

export const FOLDER_TYPES = [[1, 'Audiobooks'], [2, 'Ebooks'], [0, 'Audiobooks and ebooks']];
export function folderTypeLabel(t) {
  const hit = FOLDER_TYPES.find(([v]) => v === Number(t));
  return hit ? hit[1] : '';
}
export function typeFormats(t) {
  const n = Number(t);
  return n === 2 ? ['ebook'] : n === 0 ? ['audiobook', 'ebook'] : ['audiobook'];
}

// "/a//b" -> "/a/b/"; "" stays "".
export function dirPath(p) {
  const s = String(p || '').trim().replace(/\/{2,}/g, '/');
  if (!s) return '';
  return s.endsWith('/') ? s : `${s}/`;
}
const segments = (p) => dirPath(p).split('/').filter(Boolean);

const known = (list, v) => list.some(([x]) => x === v);
const num = (v) => (v === null || v === undefined || v === '' ? undefined : Number(v));

// Which existing books a root folder monitors for authors added to it.
// Chaptarr takes only these four here (MonitorExistingMode).
export const ROOT_MONITOR_OPTIONS = [['all', 'All books'], ['missing', 'Missing books'], ['existing', 'Existing books'], ['none', 'None']];

// POST/PUT rootfolder body, built from scratch: Chaptarr refuses settings for
// a format the folder doesn't hold (an audiobook folder with ebook fields).
//   form: { name, path, folderType, perFormat: { audiobook: { qualityProfileId,
//           metadataProfileId, monitor, monitorNewItems }, ebook: {...} } }
//   Readarr (no folder types): { name, path, qualityProfileId, metadataProfileId, monitor, monitorNewItems }
export function rootFolderBody(form, existing = null, { formatAware = true } = {}) {
  const f = form || {};
  const path = existing ? existing.path : String(f.path || '').trim();
  const out = {
    ...(existing && existing.id ? { id: existing.id } : {}),
    name: String(f.name || '').trim() || (existing && existing.name) || segments(path).pop() || '',
    path,
    isCalibreLibrary: false,
    defaultTags: (existing && existing.defaultTags) || [],
  };
  if (!formatAware) {
    return {
      ...out,
      defaultQualityProfileId: num(f.qualityProfileId), defaultMetadataProfileId: num(f.metadataProfileId),
      defaultMonitorOption: known(MONITOR_OPTIONS, f.monitor) ? f.monitor : 'all',
      defaultNewItemMonitorOption: known(NEW_ITEM_OPTIONS, f.monitorNewItems) ? f.monitorNewItems : 'all',
    };
  }
  const type = FOLDER_TYPES.some(([v]) => v === Number(f.folderType)) ? Number(f.folderType) : 1;
  out.folderType = type;
  if (existing && typeof existing.placeEbooksWithAudiobooks === 'boolean') out.placeEbooksWithAudiobooks = existing.placeEbooksWithAudiobooks;
  for (const fmt of typeFormats(type)) {
    const side = (f.perFormat && f.perFormat[fmt]) || {};
    const before = existing ? rootFolderSide(existing, fmt) : {};
    out[`${fmt}QualityProfileId`] = num(side.qualityProfileId);
    out[`${fmt}MetadataProfileId`] = num(side.metadataProfileId);
    // Whether authors added here are monitored for this format (Chaptarr's
    // default is yes); which of their existing books are is the mode below.
    out[`${fmt}Monitored`] = typeof side.monitored === 'boolean' ? side.monitored : before.monitored !== false;
    out[`${fmt}MonitorExistingMode`] = known(ROOT_MONITOR_OPTIONS, side.monitor) ? side.monitor : 'all';
    out[`${fmt}MonitorNewItems`] = known(NEW_ITEM_OPTIONS, side.monitorNewItems) ? side.monitorNewItems : 'all';
    if (existing) out[`${fmt}Tags`] = (existing[fmt] && existing[fmt].tags) || existing[`${fmt}Tags`] || [];
  }
  return out;
}

// A root folder's per-format defaults, for the edit form.
export function rootFolderSide(folder, format) {
  const s = (folder && folder[format]) || {};
  const pick = (k) => s[k] ?? (folder && folder[`${format}${k[0].toUpperCase()}${k.slice(1)}`]);
  return {
    qualityProfileId: pick('qualityProfileId') ?? null,
    metadataProfileId: pick('metadataProfileId') ?? null,
    monitored: pick('monitored') !== false,
    monitor: pick('monitorExistingMode') || 'all',
    monitorNewItems: pick('monitorNewItems') || 'all',
  };
}

// Authors whose files live under a root folder.
export function authorsInFolder(authors, folder) {
  const root = dirPath(folder && folder.path);
  if (!root) return [];
  const inRoot = (p) => p && dirPath(p).startsWith(root);
  return (authors || []).filter((a) => a && (inRoot(a.audiobookRootFolderPath) || inRoot(a.ebookRootFolderPath) || inRoot(a.rootFolderPath)
    || (!a.audiobookRootFolderPath && !a.ebookRootFolderPath && !a.rootFolderPath && inRoot(a.path))));
}

// ---- Download clients and mappings ----------------------------------------

export function clientField(client, name) {
  const f = ((client && client.fields) || []).find((x) => x && x.name === name);
  return f ? f.value : undefined;
}
export const clientHost = (client) => String(clientField(client, 'host') || '').trim();

// The mappings that apply to a client, in the order the app tries them:
// those scoped to the client first, then the host-wide ones for its host.
export function mappingsFor(mappings, { downloadClientId = 0, host = '' } = {}) {
  const list = (Array.isArray(mappings) ? mappings : []).filter(Boolean);
  const h = String(host || '').toLowerCase();
  const scoped = downloadClientId ? list.filter((m) => Number(m.downloadClientId) === Number(downloadClientId)) : [];
  const wide = list.filter((m) => !Number(m.downloadClientId) && String(m.host || '').toLowerCase() === h);
  return [...scoped, ...wide];
}

// The mapping that turns remotePath into a local one, if any.
export function mappingCovering(mappings, scope, remotePath) {
  const target = dirPath(remotePath);
  return mappingsFor(mappings, scope).find((m) => target.startsWith(dirPath(m.remotePath))) || null;
}
export function remapToLocal(mapping, remotePath) {
  if (!mapping) return dirPath(remotePath);
  return dirPath(dirPath(mapping.localPath) + dirPath(remotePath).slice(dirPath(mapping.remotePath).length));
}

// Where the app probably sees a download client's folder: line it up with a
// folder the app already knows (a root folder or a mapping's local side) on
// a shared folder name, e.g. /Volumes/12-1/Completed-AudioBooks/ next to
// /data/12-1/AudioBooks/ gives /data/12-1/Completed-AudioBooks/. Root
// folders themselves are never suggested: downloads don't belong there.
export function suggestLocalPaths(remotePath, knownLocal, { exclude = [] } = {}) {
  const remote = segments(remotePath);
  if (!remote.length) return [];
  const excluded = new Set((exclude || []).map((p) => dirPath(p).toLowerCase()));
  const found = new Map();
  for (const cand of knownLocal || []) {
    const local = segments(cand);
    for (let i = 0; i < remote.length; i++) {
      for (let j = 0; j < local.length; j++) {
        if (remote[i].toLowerCase() !== local[j].toLowerCase()) continue;
        if (i === 0 && j === 0) continue; // same top folder: nothing to map
        let run = 0;
        while (i + run < remote.length && j + run < local.length && remote[i + run].toLowerCase() === local[j + run].toLowerCase()) run++;
        const path = dirPath(`/${[...local.slice(0, j), ...remote.slice(i)].join('/')}`);
        if (excluded.has(path.toLowerCase()) || path.toLowerCase() === dirPath(remotePath).toLowerCase()) continue;
        const score = run * 10 + (remote.length - i) - j;
        if (!found.has(path) || found.get(path) < score) found.set(path, score);
      }
    }
  }
  return [...found.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
}

// The smallest mapping that covers the remote folder, as a suggestion.
export function suggestedMapping(remotePath, localPath) {
  return { remotePath: dirPath(remotePath), localPath: dirPath(localPath) };
}

// Chaptarr's remotepathmapping/test answer as lines to show, each ok / bad /
// unknown (null).
export function mappingTestLines(result, { app = 'The app', client = 'The download client' } = {}) {
  const r = result || {};
  const lines = [];
  if (r.isMapped === false) lines.push({ ok: false, text: `This mapping leaves the path as it is (${r.remotePath || ''}).` });
  else if (r.mappedPath) lines.push({ ok: null, text: `${app} reads ${r.remotePath} as ${r.mappedPath}.` });
  if (r.localPathExists === false) lines.push({ ok: false, text: `${app} can’t find ${r.localPath}. Check the path, or that the drive is mounted in its container.` });
  else if (r.localPathExists) {
    lines.push(r.localPathWritable === false
      ? { ok: false, text: `${app} can see ${r.localPath} but can’t write there. Imports move files out of it, so it needs write access.` }
      : { ok: true, text: `${app} can see ${r.localPath} and write there.` });
  }
  if (r.downloadClientPathChecked) {
    lines.push(r.downloadClientPathMatched
      ? { ok: true, text: `${client} saves downloads to ${r.downloadClientMatchedPath}, which this mapping covers.` }
      : { ok: false, text: `${client}’s download folder isn’t under ${r.remotePath}, so this mapping won’t apply to its downloads.` });
  }
  if (r.downloadClientItemPathChecked) {
    lines.push(r.downloadClientItemPathExists
      ? { ok: r.downloadClientItemPathWritable !== false, text: `A finished download is at ${r.downloadClientItemMappedPath}${r.downloadClientItemPathWritable === false ? ', but it can’t be moved (no write access).' : ', and it can be imported.'}` }
      : { ok: false, text: `${client} lists a download that would be at ${r.downloadClientItemMappedPath}, but ${app} can’t find it there.` });
  }
  if (r.downloadClientTestError) lines.push({ ok: null, text: r.downloadClientTestError });
  return lines;
}

// One download-client folder, checked: is it mapped, and can the app reach
// what it maps to?
//   mapping: the mapping covering it (or null); test: Chaptarr's test of it;
//   direct: Chaptarr's test of the folder unmapped (does it exist as is).
export function folderVerdict({ remotePath, mapping = null, test = null, direct = null, app = 'The app', client = 'The download client' }) {
  const remote = dirPath(remotePath);
  if (mapping) {
    const local = remapToLocal(mapping, remote);
    if (test && test.mappedPathExists === false) {
      return { status: 'problem', title: `${app} can’t find ${local}`, detail: `${client} saves to ${remote}; the mapping turns that into ${local}, which ${app} can’t see.` };
    }
    if (test && test.mappedPathWritable === false) {
      return { status: 'warning', title: `${app} can’t write to ${local}`, detail: `Imports move files out of the download folder, so ${app} needs write access there.` };
    }
    return { status: test ? 'ok' : 'unknown', title: `${remote} → ${local}`, detail: test ? `${app} can see the folder and write there.` : 'Not tested.' };
  }
  if (direct && direct.localPathExists) {
    return { status: direct.localPathWritable === false ? 'warning' : 'ok', title: `${app} sees ${remote} as is`, detail: direct.localPathWritable === false ? `But it can’t write there, so imports can’t move files.` : 'No mapping needed.' };
  }
  return {
    status: direct ? 'problem' : 'unknown',
    title: `${app} can’t see ${remote}`,
    detail: `${client} saves downloads there, and no remote path mapping turns it into a folder ${app} can reach. Downloads stay waiting to import.`,
  };
}
