// Folders for a book manager (Chaptarr, legacy Readarr): root folders, the
// download clients' folders checked against the remote path mappings, and
// the mappings themselves, with Chaptarr's own mapping test. These are the
// app's settings, so ArrCC shows them to admins only. Pure logic is
// lib/bookSettings.js.
import { h, mount, spinner, skeletonList, empty, toast, fmtBytes, openModal, closeModal, confirmModal } from './ui.js';
import { cachedList, invalidate } from './cache.js';
import { FORMATS, MONITOR_OPTIONS, NEW_ITEM_OPTIONS, profilesFor, isFormatAware } from './readarrLibrary.js';
import {
  FOLDER_TYPES, ROOT_MONITOR_OPTIONS, folderTypeLabel, typeFormats, dirPath, rootFolderBody, rootFolderSide, authorsInFolder,
  clientHost, mappingsFor, mappingCovering, remapToLocal, suggestLocalPaths, mappingTestLines, folderVerdict,
} from './bookSettings.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const STATUS = { ok: ['ok', '✓'], warning: ['warn', '!'], problem: ['down', '✕'], unknown: ['muted', '?'] };

function field(label, control, hint) {
  return h('div', { class: 'form-field' },
    h('div', { class: 'section-title', style: { margin: '0 0 6px' } }, label),
    control,
    hint ? h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '4px' } }, hint) : null);
}
function selectOf(options, value) {
  const sel = h('select', { class: 'input' }, ...options.map(([v, label]) => h('option', { value: String(v) }, label)));
  if (value !== null && value !== undefined && options.some(([v]) => String(v) === String(value))) sel.value = String(value);
  return sel;
}
function chips(paths, onPick) {
  const list = [...new Set((paths || []).map(dirPath).filter(Boolean))];
  if (!list.length) return null;
  return h('div', { class: 'path-chips' }, ...list.slice(0, 6).map((p) => h('button', { class: 'chip mono', type: 'button', title: `Use ${p}`, onclick: () => onPick(p) }, p)));
}

// Folders as the app sees them (its own filesystem API: inside its
// container when it runs in Docker).
function folderBrowser(arr, start, onPick) {
  const el = h('div', { class: 'folder-browser' });
  const load = async (path) => {
    mount(el, spinner());
    try {
      const r = await arr.get(`filesystem?path=${encodeURIComponent(path || '')}&allowFoldersWithoutTrailingSlashes=true`);
      if (!el.isConnected) return;
      const dirs = ((r && r.directories) || []).filter((d) => d && d.path && !/^\./.test(d.name || ''));
      mount(el,
        h('div', { class: 'folder-browser-head' },
          h('span', { class: 'mono folder-browser-path' }, path || 'Top level'),
          path ? h('button', { class: 'btn sm', type: 'button', onclick: () => load(r && r.parent !== undefined && r.parent !== null ? r.parent : '') }, '‹ Up') : null,
          path ? h('button', { class: 'btn sm primary', type: 'button', onclick: () => onPick(dirPath(path)) }, 'Use this folder') : null),
        dirs.length
          ? h('div', { class: 'folder-browser-list' }, ...dirs.map((d) => h('button', { class: 'folder-browser-row', type: 'button', onclick: () => load(d.path) }, h('span', { 'aria-hidden': 'true' }, '📁'), h('span', {}, d.name || d.path))))
          : h('div', { class: 'dim', style: { padding: '8px 2px' } }, 'No folders in here.'));
    } catch (e) { mount(el, h('div', { class: 'dim' }, `Couldn’t list folders: ${e.message}`)); }
  };
  load(start || '');
  return el;
}

// A path input with a Browse button that opens the folder list under it.
function pathInput(arr, value, { placeholder, readOnly = false } = {}) {
  const input = h('input', { class: 'input mono', type: 'text', value: value || '', placeholder: placeholder || '/path/to/folder/', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', readonly: readOnly ? 'readonly' : null });
  const slot = h('div', {});
  const browse = readOnly ? null : h('button', { class: 'btn sm', type: 'button', onclick: () => {
    if (slot.firstChild) { mount(slot); return; }
    mount(slot, folderBrowser(arr, input.value.trim().replace(/\/[^/]*$/, '') || '', (p) => { input.value = p; input.dispatchEvent(new Event('input')); mount(slot); }));
  } }, 'Browse…');
  return { input, el: h('div', {}, h('div', { class: 'path-input' }, input, browse), slot) };
}

// ---- The tab ---------------------------------------------------------------

export async function tabFolders(root, arr, ctx) {
  const app = ctx.service.label;
  const key = ctx.service.key;
  mount(root, skeletonList());
  let folders; let mappings; let clients; let profiles; let metas; let authors;
  try {
    [folders, mappings, clients, profiles, metas, authors] = await Promise.all([
      arr.get('rootfolder'),
      arr.get('remotepathmapping').catch(() => []),
      arr.get('downloadclient').catch(() => []),
      arr.get('qualityprofile').catch(() => []),
      arr.get('metadataprofile').catch(() => null),
      cachedList(`arr:${key}:author`, () => arr.get('author'), 300000).catch(() => []),
    ]);
  } catch (e) {
    return mount(root, empty('', 'Couldn’t load the folders', e.message, { label: 'Retry', onClick: () => tabFolders(root, arr, ctx) }));
  }
  folders = Array.isArray(folders) ? folders : [];
  mappings = Array.isArray(mappings) ? mappings : [];
  clients = (Array.isArray(clients) ? clients : []).filter((c) => c && c.enable !== false);
  profiles = Array.isArray(profiles) ? profiles : [];
  metas = Array.isArray(metas) ? metas : null;
  const formatAware = folders.some(isFormatAware) || profiles.some((p) => p && p.profileType);
  const env = { app, arr, ctx, folders, mappings, clients, profiles, metas, authors: Array.isArray(authors) ? authors : [], formatAware };
  const reload = () => { invalidate(`arr:${key}:rootfolder`); tabFolders(root, arr, ctx); };
  env.reload = reload;

  const checkSlot = h('div', {});
  mount(root,
    h('div', { class: 'section-head' },
      h('div', { class: 'section-title', style: { margin: 0 } }, 'Root folders'),
      h('button', { class: 'btn sm primary', type: 'button', onclick: () => openRootFolderForm(env, null) }, '+ Add root folder')),
    h('p', { class: 'dim section-note' }, `Where ${app} keeps the library. Each holds audiobooks, ebooks or both, and sets the defaults for authors added to it.`),
    folders.length ? h('div', { class: 'list' }, ...folders.map((f) => rootFolderRow(env, f))) : empty('📁', 'No root folder yet', `Add one so ${app} has somewhere to put books.`),
    h('div', { class: 'section-head' },
      h('div', { class: 'section-title', style: { margin: 0 } }, 'Download folders')),
    h('p', { class: 'dim section-note' }, `Where each download client saves finished downloads, and whether ${app} can reach that folder to import from it.`),
    checkSlot,
    h('div', { class: 'section-head' },
      h('div', { class: 'section-title', style: { margin: 0 } }, 'Remote path mappings'),
      h('button', { class: 'btn sm primary', type: 'button', onclick: () => openMappingForm(env, null) }, '+ Add mapping')),
    h('p', { class: 'dim section-note' }, `A mapping tells ${app} that a folder the download client reports (its own path) is a different path for ${app}, as when ${app} runs in Docker. Capitals count: the remote path must match the client’s setting exactly.`),
    mappings.length ? h('div', { class: 'list' }, ...mappings.map((m) => mappingRow(env, m))) : h('div', { class: 'dim', style: { margin: '4px 0 12px' } }, 'No mappings.'),
  );
  runDownloadCheck(env, checkSlot);
}

function rootFolderRow(env, f) {
  const n = authorsInFolder(env.authors, f).length;
  const free = Number(f.freeSpace);
  return h('div', { class: 'row root-folder-row' },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title', style: { fontSize: '14px' } }, f.name || f.path),
      f.name ? h('div', { class: 'mono dim', style: { fontSize: '12px', marginTop: '2px', overflowWrap: 'anywhere' } }, f.path) : null,
      h('div', { class: 'meta-line', style: { marginTop: '5px' } },
        env.formatAware ? h('span', { class: 'pill muted' }, typeFormats(f.folderType).map((x) => FORMATS[x].icon).join(' '), ' ', folderTypeLabel(f.folderType)) : null,
        f.isEffectiveDefaultAudiobook ? h('span', { class: 'pill info' }, 'Default for audiobooks') : null,
        f.isEffectiveDefaultEbook ? h('span', { class: 'pill info' }, 'Default for ebooks') : null,
        f.accessible === false ? h('span', { class: 'pill down' }, 'Can’t be reached') : null,
        Number.isFinite(free) && free > 0 ? h('span', {}, `${fmtBytes(free)} free`) : null,
        h('span', { class: 'dim' }, plural(n, 'author')),
        Array.isArray(f.unmappedFolders) && f.unmappedFolders.length ? h('span', { class: 'dim' }, `${plural(f.unmappedFolders.length, 'folder')} not in the library`) : null)),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn sm', type: 'button', onclick: () => openRootFolderForm(env, f) }, 'Edit'),
      h('button', { class: 'btn sm danger', type: 'button', onclick: () => removeRootFolder(env, f, n) }, 'Remove')));
}

function removeRootFolder(env, f, authorCount) {
  confirmModal({
    title: 'Remove root folder',
    message: `Remove ${f.path} from ${env.app}? Nothing on disk is deleted.${authorCount ? ` ${plural(authorCount, 'author')} ${authorCount === 1 ? 'is' : 'are'} still set to this folder; ${env.app} may refuse, or leave them pointing at a folder it no longer lists.` : ''}`,
    confirmLabel: 'Remove', danger: true,
    onConfirm: async () => {
      try { await env.arr.del(`rootfolder/${f.id}`); toast(`Removed ${f.path}`, 'success'); env.reload(); }
      catch (e) { if (!e.cancelled) toast(e.message, 'error', 6000); }
    },
  });
}

function openRootFolderForm(env, existing) {
  const { app, arr, profiles, metas, formatAware } = env;
  const name = h('input', { class: 'input', type: 'text', value: (existing && existing.name) || '', placeholder: formatAware ? 'Audiobooks' : 'Books' });
  const path = pathInput(arr, existing ? existing.path : '', { readOnly: !!existing });
  const typeSel = formatAware ? selectOf(FOLDER_TYPES, existing ? existing.folderType : 1) : null;
  const sidesSlot = h('div', { class: 'grid', style: { gap: '12px' } });
  let sides = {};
  const renderSides = () => {
    const fmts = formatAware ? typeFormats(typeSel.value) : [null];
    sides = {};
    mount(sidesSlot, ...fmts.map((fmt) => {
      const before = existing ? (fmt ? rootFolderSide(existing, fmt) : {
        qualityProfileId: existing.defaultQualityProfileId, metadataProfileId: existing.defaultMetadataProfileId,
        monitor: existing.defaultMonitorOption, monitorNewItems: existing.defaultNewItemMonitorOption,
      }) : {};
      const qList = profilesFor(profiles, fmt);
      const mList = metas ? profilesFor(metas, fmt) : [];
      const q = qList.length ? selectOf(qList.map((p) => [p.id, p.name]), before.qualityProfileId ?? qList[0].id) : null;
      const m = mList.length ? selectOf(mList.map((p) => [p.id, p.name]), before.metadataProfileId ?? mList[0].id) : null;
      const mon = selectOf(fmt ? ROOT_MONITOR_OPTIONS : MONITOR_OPTIONS, before.monitor || 'all');
      const ni = selectOf(NEW_ITEM_OPTIONS, before.monitorNewItems || 'all');
      sides[fmt || ''] = { q, m, mon, ni, fallbackMeta: before.metadataProfileId };
      return h('div', { class: 'edit-format' },
        fmt ? h('div', { class: 'edit-format-title' }, `${FORMATS[fmt].icon} ${FORMATS[fmt].label}: defaults for new authors`) : h('div', { class: 'edit-format-title' }, 'Defaults for new authors'),
        q ? field('Quality profile', q) : null,
        m ? field('Metadata profile', m) : null,
        field('Monitor existing books', mon),
        field('Monitor new books', ni));
    }));
  };
  if (typeSel) typeSel.addEventListener('change', renderSides);
  renderSides();

  const save = async (btn) => {
    const p = path.input.value.trim();
    if (!existing && !p) { toast('Choose a folder first', 'error'); return; }
    const side = (k) => sides[k] || {};
    const val = (sel, fb) => (sel ? sel.value : fb);
    const form = formatAware
      ? { name: name.value, path: p, folderType: typeSel.value, perFormat: Object.fromEntries(typeFormats(typeSel.value).map((fmt) => [fmt, { qualityProfileId: val(side(fmt).q), metadataProfileId: val(side(fmt).m, side(fmt).fallbackMeta), monitor: side(fmt).mon.value, monitorNewItems: side(fmt).ni.value }])) }
      : { name: name.value, path: p, qualityProfileId: val(side('').q), metadataProfileId: val(side('').m, side('').fallbackMeta ?? 1), monitor: side('').mon.value, monitorNewItems: side('').ni.value };
    const body = rootFolderBody(form, existing, { formatAware });
    btn.disabled = true;
    try {
      if (existing) await arr.put(`rootfolder/${existing.id}`, body);
      else await arr.post('rootfolder', body);
      toast(existing ? `Saved ${body.name || body.path}` : `Added ${body.path}`, 'success');
      closeModal();
      env.reload();
    } catch (e) {
      toast(e.message, 'error', 7000);
      btn.disabled = false;
    }
  };
  openModal({
    title: existing ? `Edit root folder` : 'Add root folder',
    body: h('div', { class: 'grid', style: { gap: '14px' } },
      field('Folder', path.el, existing ? 'The folder of a root folder can’t change. Add a new one instead.' : `As ${app} sees it: inside its container when it runs in Docker.`),
      field('Name', name),
      typeSel ? field('Holds', typeSel) : null,
      sidesSlot),
    footer: h('div', { style: { display: 'flex', gap: '10px' } },
      h('button', { class: 'btn', type: 'button', onclick: closeModal }, 'Cancel'),
      h('button', { class: 'btn primary', type: 'button', onclick: (e) => save(e.currentTarget) }, existing ? 'Save' : 'Add root folder')),
  });
}

// ---- Download folders, checked ---------------------------------------------

// For each enabled download client: the folders it saves to (Chaptarr's
// suggestions), each run through Chaptarr's mapping test as it is mapped
// now, or as is when no mapping covers it. A folder the app can't reach
// gets a suggested mapping, tried with the same test first.
async function runDownloadCheck(env, slot) {
  const { app, arr, clients, mappings, folders } = env;
  if (!clients.length) { mount(slot, h('div', { class: 'dim', style: { margin: '4px 0 12px' } }, `${app} has no download client.`)); return; }
  mount(slot, h('div', { class: 'dim', style: { margin: '4px 0 12px' } }, spinner(), ' Checking each download client’s folders…'));
  const blocks = [];
  let supported = true;
  for (const c of clients) {
    const host = clientHost(c);
    let sug;
    try { sug = await arr.get(`remotepathmapping/suggestions?downloadClientId=${c.id}`); }
    catch (e) { if (e.status === 404 || e.status === 405) { supported = false; break; } blocks.push({ client: c, error: e.message, rows: [] }); continue; }
    const test = (body) => arr.post('remotepathmapping/test', { downloadClientId: c.id, host, ...body });
    const local = [...folders.map((f) => f.path), ...mappings.map((m) => m.localPath), ...((sug && sug.chaptarrPaths) || [])];
    const rows = [];
    for (const remote of [...new Set(((sug && sug.downloadClientPaths) || []).map(dirPath))]) {
      const mapping = mappingCovering(mappings, { downloadClientId: c.id, host }, remote);
      let t = null;
      try { t = await test({ remotePath: remote, localPath: mapping ? remapToLocal(mapping, remote) : remote }); } catch { /* shown as unknown */ }
      // A mapping's own remote side comes back too; only the client's folders count.
      if (t && t.downloadClientPathChecked && !t.downloadClientPathMatched) continue;
      const verdict = folderVerdict({
        remotePath: remote, mapping, app, client: c.name,
        test: mapping && t ? { mappedPathExists: t.localPathExists, mappedPathWritable: t.localPathWritable } : null,
        direct: !mapping ? t : null,
      });
      let fix = null;
      if (verdict.status === 'problem') {
        for (const cand of suggestLocalPaths(remote, local, { exclude: folders.map((f) => f.path) }).slice(0, 4)) {
          try { const r = await test({ remotePath: remote, localPath: cand }); if (r && r.localPathExists) { fix = { remotePath: remote, localPath: cand, downloadClientId: 0, host }; break; } } catch { /* try the next */ }
        }
        if (!fix) fix = { remotePath: remote, localPath: '', downloadClientId: 0, host };
      }
      rows.push({ remote, verdict, fix });
    }
    blocks.push({ client: c, rows });
  }
  if (!slot.isConnected) return;
  if (!supported) {
    mount(slot, h('div', { class: 'dim', style: { margin: '4px 0 12px' } }, `${app} can’t test mappings (Chaptarr can). Check the mappings below against each download client’s settings.`));
    return;
  }
  mount(slot, ...blocks.map((b) => h('div', { class: 'download-check' },
    h('div', { class: 'download-check-head' }, h('b', {}, b.client.name), clientHost(b.client) ? h('span', { class: 'dim' }, clientHost(b.client)) : null),
    b.error ? h('div', { class: 'dim' }, `Couldn’t ask ${app} about it: ${b.error}`) : null,
    !b.error && !b.rows.length ? h('div', { class: 'dim' }, `${app} didn’t get a download folder from it.`) : null,
    ...b.rows.map((r) => {
      const [cls, mark] = STATUS[r.verdict.status] || STATUS.unknown;
      return h('div', { class: 'row download-check-row' },
        h('span', { class: `pill ${cls} check-mark`, 'aria-label': r.verdict.status }, mark),
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title mono', style: { fontSize: '13px', overflowWrap: 'anywhere' } }, r.verdict.title),
          h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '3px' } }, r.verdict.detail),
          r.fix && r.fix.localPath ? h('div', { style: { fontSize: '12px', marginTop: '4px' } }, h('b', {}, 'Suggested: '), h('span', { class: 'mono' }, `${r.fix.remotePath} → ${r.fix.localPath}`), h('span', { class: 'dim' }, ` (${app} can see that folder)`)) : null),
        r.fix ? h('div', { class: 'row-actions' }, h('button', { class: 'btn sm primary', type: 'button', onclick: () => openMappingForm(env, null, r.fix) }, r.fix.localPath ? 'Add this mapping' : 'Add mapping…')) : null);
    }))));
}

// ---- Remote path mappings --------------------------------------------------

function mappingRow(env, m) {
  const client = env.clients.find((c) => Number(c.id) === Number(m.downloadClientId));
  const out = h('div', {});
  const testBtn = h('button', { class: 'btn sm', type: 'button', title: `Ask ${env.app} to check this mapping`, onclick: async () => {
    testBtn.disabled = true;
    mount(out, spinner());
    const scope = client || env.clients.find((c) => clientHost(c).toLowerCase() === String(m.host || '').toLowerCase());
    try {
      const r = await env.arr.post('remotepathmapping/test', { downloadClientId: scope ? scope.id : 0, host: m.host, remotePath: m.remotePath, localPath: m.localPath });
      mount(out, testLines(mappingTestLines(r, { app: env.app, client: scope ? scope.name : 'The download client' })));
    } catch (e) {
      mount(out, h('div', { class: 'dim', style: { fontSize: '12px' } }, e.status === 404 || e.status === 405 ? `${env.app} can’t test mappings.` : e.message));
    }
    testBtn.disabled = false;
  } }, 'Test');
  return h('div', { class: 'row mapping-row' },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title mono', style: { fontSize: '13px', overflowWrap: 'anywhere' } }, `${m.remotePath} → ${m.localPath}`),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: 'dim' }, client ? `Only ${client.name}` : `Any client on ${m.host}`)),
      out),
    h('div', { class: 'row-actions' },
      testBtn,
      h('button', { class: 'btn sm', type: 'button', onclick: () => openMappingForm(env, m) }, 'Edit'),
      h('button', { class: 'btn sm danger', type: 'button', onclick: () => confirmModal({
        title: 'Remove mapping', message: `Remove the mapping ${m.remotePath} → ${m.localPath}? Downloads from that folder will wait to import again until ${env.app} can reach them.`, confirmLabel: 'Remove', danger: true,
        onConfirm: async () => { try { await env.arr.del(`remotepathmapping/${m.id}`); toast('Mapping removed', 'success'); env.reload(); } catch (e) { if (!e.cancelled) toast(e.message, 'error', 6000); } },
      }) }, 'Remove')));
}

function testLines(lines) {
  if (!lines.length) return h('div', { class: 'dim', style: { fontSize: '12px' } }, 'Nothing to report.');
  return h('ul', { class: 'test-lines' }, ...lines.map((l) => h('li', { class: l.ok === true ? 'ok' : l.ok === false ? 'bad' : 'info' }, h('span', { class: 'test-mark', 'aria-hidden': 'true' }, l.ok === true ? '✓' : l.ok === false ? '✕' : '•'), l.text)));
}

function openMappingForm(env, existing, prefill = null) {
  const { app, arr, clients, folders, mappings } = env;
  const start = existing || prefill || {};
  const otherValue = '__other__';
  const hostClients = clients.filter((c) => clientHost(c));
  const pickClient = hostClients.find((c) => Number(c.id) === Number(start.downloadClientId))
    || hostClients.find((c) => clientHost(c).toLowerCase() === String(start.host || '').toLowerCase()) || hostClients[0] || null;
  const clientSel = selectOf([...hostClients.map((c) => [c.id, `${c.name} (${clientHost(c)})`]), [otherValue, 'Another host…']], pickClient ? pickClient.id : otherValue);
  const hostIn = h('input', { class: 'input', type: 'text', value: start.host || '', placeholder: '192.168.1.10', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
  const hostWrap = h('div', {}, field('Host', hostIn, 'Exactly as the download client’s Host setting says.'));
  const onlyThis = h('input', { type: 'checkbox', checked: Number(start.downloadClientId) > 0 ? 'checked' : null });
  const onlyWrap = h('label', { class: 'dim', style: { display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px' } }, onlyThis, 'Only for this download client (when others on the same host report other paths)');
  const remote = h('input', { class: 'input mono', type: 'text', value: start.remotePath || '', placeholder: '/Volumes/Downloads/complete/', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
  const local = pathInput(arr, start.localPath || '', { placeholder: '/downloads/complete/' });
  const remoteChips = h('div', {});
  const localChips = h('div', {});
  const result = h('div', {});
  const client = () => clients.find((c) => String(c.id) === clientSel.value) || null;
  const host = () => (client() ? clientHost(client()) : hostIn.value.trim());
  const scopeId = () => (client() && onlyThis.checked ? Number(client().id) : 0);
  const refreshScope = async () => {
    const c = client();
    hostWrap.hidden = !!c;
    onlyWrap.hidden = !c;
    mount(remoteChips); mount(localChips);
    if (!c) return;
    try {
      const sug = await arr.get(`remotepathmapping/suggestions?downloadClientId=${c.id}`);
      const fromClient = (sug.downloadClientPaths || []).filter((p) => !mappings.some((m) => dirPath(m.remotePath) === dirPath(p) && (!existing || m.id !== existing.id)));
      mount(remoteChips, chips(fromClient.length ? fromClient : sug.downloadClientPaths, (p) => { remote.value = p; suggestLocal(); }));
      suggestLocal(sug.chaptarrPaths || []);
    } catch { /* Readarr has no suggestions */ }
  };
  let knownLocal = [];
  const suggestLocal = (extra) => {
    if (extra) knownLocal = extra;
    const guesses = remote.value.trim() ? suggestLocalPaths(remote.value, [...folders.map((f) => f.path), ...mappings.map((m) => m.localPath), ...knownLocal], { exclude: folders.map((f) => f.path) }) : [];
    mount(localChips, chips([...guesses, ...knownLocal.filter((p) => !folders.some((f) => dirPath(f.path) === dirPath(p)))], (p) => { local.input.value = p; }));
  };
  remote.addEventListener('change', () => suggestLocal());
  clientSel.addEventListener('change', refreshScope);
  const body = () => ({ ...(existing ? { id: existing.id } : {}), downloadClientId: scopeId(), host: host(), remotePath: dirPath(remote.value), localPath: dirPath(local.input.value) });
  const testBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
    const b = body();
    if (!b.host || !b.remotePath || !b.localPath) { toast('Fill in the host and both paths first', 'error'); return; }
    testBtn.disabled = true; mount(result, spinner());
    try {
      const r = await arr.post('remotepathmapping/test', { ...b, downloadClientId: client() ? Number(client().id) : 0 });
      mount(result, testLines(mappingTestLines(r, { app, client: client() ? client().name : 'The download client' })));
    } catch (e) { mount(result, h('div', { class: 'dim' }, e.status === 404 || e.status === 405 ? `${app} can’t test mappings; save it and watch the next download.` : e.message)); }
    testBtn.disabled = false;
  } }, 'Test');
  const save = async (btn) => {
    const b = body();
    if (!b.host || !b.remotePath || !b.localPath) { toast('Fill in the host and both paths first', 'error'); return; }
    btn.disabled = true;
    try {
      if (existing) await arr.put(`remotepathmapping/${existing.id}`, b);
      else await arr.post('remotepathmapping', b);
      toast(existing ? 'Mapping saved' : 'Mapping added', 'success');
      closeModal();
      env.reload();
    } catch (e) { toast(e.message, 'error', 7000); btn.disabled = false; }
  };
  openModal({
    title: existing ? 'Edit remote path mapping' : 'Add remote path mapping',
    wide: true,
    body: h('div', { class: 'grid', style: { gap: '14px' } },
      field('Download client', clientSel),
      hostWrap,
      onlyWrap,
      field('Remote path', h('div', {}, remote, remoteChips), 'The folder as the download client reports it. Capitals count.'),
      field('Local path', h('div', {}, local.el, localChips), `The same folder as ${app} sees it.`),
      result),
    footer: h('div', { style: { display: 'flex', gap: '10px' } },
      h('button', { class: 'btn', type: 'button', onclick: closeModal }, 'Cancel'),
      testBtn,
      h('button', { class: 'btn primary', type: 'button', onclick: (e) => save(e.currentTarget) }, existing ? 'Save' : 'Add mapping')),
  });
  refreshScope();
}
