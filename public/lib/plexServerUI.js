// Plex → "Server": libraries with Scan, Refresh details and Empty trash.
// Plex → "Friends & sharing": who the server is shared with, which libraries
// each person has, invite someone, change libraries, stop sharing (admins).
import { h, mount, skeletonList, empty, toast, fmtRelative } from './ui.js';
import { api } from './api.js';
import { roleAllows } from './roleUi.js';

const TYPE = { movie: 'Movie library', show: 'TV library', artist: 'Music library', photo: 'Photo library' };
const when = (unix) => (unix ? fmtRelative(new Date(unix * 1000).toISOString()) : 'never');

export function tabServer(root) {
  const load = async (quiet = false) => {
    if (!quiet) mount(root, skeletonList(3));
    let d;
    try { d = await api.getJson('/api/plex/server'); } catch (e) { mount(root, empty('', 'Couldn’t reach the Plex server', e.message)); return; }
    const act = async (btn, lib, action, done) => {
      btn.disabled = true;
      try { await api.sendJson(`/api/plex/library/${encodeURIComponent(lib.key)}/${action}`, {}); toast(done, 'success', 4000); setTimeout(() => { if (root.isConnected) load(true); }, 2500); }
      catch (e) { toast(e.message, 'error'); btn.disabled = false; }
    };
    const row = (lib) => {
      const scan = h('button', { class: 'btn sm primary', 'data-needs': 'write', title: 'Look for new, changed and removed files', onclick: () => act(scan, lib, 'scan', `Plex is scanning ${lib.title}`) }, 'Scan');
      const refresh = h('button', { class: 'btn sm', 'data-needs': 'write', title: 'Download details, posters and art again for everything in this library. Can take a long time on big libraries.', onclick: () => act(refresh, lib, 'refresh', `Plex is refreshing the details in ${lib.title}`) }, 'Refresh details');
      const trash = h('button', { class: 'btn sm danger', 'data-needs': 'admin', title: 'Remove items whose files are gone (their watch history goes with them)', onclick: () => {
        if (trash.dataset.armed !== '1') { trash.dataset.armed = '1'; trash.textContent = 'Empty trash?'; return; }
        act(trash, lib, 'emptyTrash', `Emptied the trash in ${lib.title}`);
      } }, 'Empty trash');
      return h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', style: { fontSize: '14px' } }, lib.title, ' ', h('span', { class: 'pill muted' }, TYPE[lib.type] || lib.type), lib.refreshing ? h('span', { class: 'pill info', style: { marginLeft: '4px' } }, 'Scanning…') : null),
          h('div', { class: 'meta-line' }, lib.count != null ? h('span', {}, `${lib.count} ${lib.count === 1 ? 'item' : 'items'}`) : null, h('span', { class: 'dim' }, `scanned ${when(lib.scannedAt)}`))),
        h('div', { class: 'row-actions', style: { flexWrap: 'wrap' } }, scan, refresh, trash));
    };
    const all = h('button', { class: 'btn sm', 'data-needs': 'write', onclick: async () => {
      all.disabled = true; let ok = 0;
      for (const lib of d.libraries) { try { await api.sendJson(`/api/plex/library/${encodeURIComponent(lib.key)}/scan`, {}); ok += 1; } catch { /* counted */ } }
      toast(`Plex is scanning ${ok} of ${d.libraries.length} libraries`, ok === d.libraries.length ? 'success' : 'warn');
      setTimeout(() => { if (root.isConnected) load(true); }, 2500);
    } }, 'Scan all libraries');
    mount(root,
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' } },
        h('div', { style: { flex: '1' } }, h('b', {}, d.name), h('span', { class: 'dim', style: { fontSize: '13px' } }, [d.version && ` · v${d.version}`, d.platform && ` · ${d.platform}`].filter(Boolean).join(''))),
        d.libraries.length > 1 ? all : null, h('button', { class: 'btn sm', onclick: () => load() }, 'Check again')),
      d.libraries.length ? h('div', { class: 'list' }, ...d.libraries.map(row)) : empty('', 'No libraries', 'This Plex server has no libraries yet.'),
      h('p', { class: 'dim', style: { fontSize: '12px', marginTop: '10px' } }, 'Empty trash removes titles whose files Plex can no longer find, with their watch history. If a drive is disconnected, reconnect it and scan first, or Plex will treat everything on it as gone.'));
  };
  load();
}

export function tabSharing(root) {
  const load = async () => {
    mount(root, skeletonList(3));
    let d;
    try { d = await api.getJson('/api/plex/shares'); } catch (e) { mount(root, empty('', 'Couldn’t read sharing from plex.tv', e.message)); return; }
    const libName = new Map(d.libraries.map((l) => [l.id, l.title]));
    const picker = (selected) => {
      const set = new Set(selected);
      const box = h('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '13px' } }, ...d.libraries.map((l) => h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
        h('input', { type: 'checkbox', checked: set.has(l.id) ? 'checked' : null, onchange: (e) => { if (e.target.checked) set.add(l.id); else set.delete(l.id); } }), l.title)));
      return { box, value: () => d.libraries.map((l) => l.id).filter((id) => set.has(id)) };
    };
    const send = async (btn, method, url, body, done) => {
      btn.disabled = true;
      try { await api.sendJson(url, body, method); toast(done, 'success', 5000); load(); }
      catch (e) { toast(e.message, 'error', 8000); btn.disabled = false; }
    };

    // Invite someone new.
    const who = h('input', { class: 'input', placeholder: 'Plex username or email', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', style: { flex: '1', minWidth: '200px' } });
    const invLibs = picker(d.libraries.map((l) => l.id));
    const dl = h('input', { type: 'checkbox', role: 'switch' });
    const inviteBtn = h('button', { class: 'btn sm primary', onclick: () => {
      const libs = invLibs.value();
      if (!who.value.trim()) { who.focus(); return; }
      if (!libs.length) { toast('Pick at least one library', 'warn'); return; }
      send(inviteBtn, 'POST', '/api/plex/shares', { who: who.value.trim(), libraries: libs, allowDownloads: dl.checked }, `Invited ${who.value.trim()}. They get access once they accept.`);
    } }, 'Send invite');

    const row = (u) => {
      const editSlot = h('div', {});
      const badges = [u.home ? h('span', { class: 'pill info' }, u.managed ? 'Managed (Home)' : 'Home') : null, u.pending ? h('span', { class: 'pill warn' }, 'Invited, not accepted yet') : null];
      if (!u.shareId) {
        const share = h('button', { class: 'btn sm', onclick: () => {
          const p = picker(d.libraries.map((l) => l.id));
          const go = h('button', { class: 'btn sm primary', onclick: () => { const libs = p.value(); if (!libs.length) { toast('Pick at least one library', 'warn'); return; } send(go, 'POST', '/api/plex/shares', { userId: u.userId, libraries: libs }, `Shared with ${u.title}`); } }, 'Share');
          mount(editSlot, h('div', { style: { display: 'grid', gap: '8px', marginTop: '8px' } }, p.box, h('div', {}, go)));
        } }, 'Share libraries');
        return h('div', { class: 'row', style: { alignItems: 'flex-start', flexWrap: 'wrap' } },
          h('div', { class: 'row-main' }, h('div', { class: 'row-title', style: { fontSize: '14px' } }, u.title, ' ', ...badges),
            h('div', { class: 'meta-line' }, u.username ? h('span', { class: 'dim' }, `@${u.username}`) : null, u.email ? h('span', { class: 'dim' }, u.email) : null, h('span', { class: 'dim' }, 'No access to this server'))),
          h('div', { class: 'row-actions' }, share), h('div', { style: { flexBasis: '100%' } }, editSlot));
      }
      const libs = u.libraries.length === d.libraries.length ? 'All libraries' : u.libraries.map((id) => libName.get(id) || id).join(', ') || 'No libraries';
      const change = h('button', { class: 'btn sm', onclick: () => {
        const p = picker(u.libraries);
        const save = h('button', { class: 'btn sm primary', onclick: () => { const v = p.value(); if (!v.length) { toast('Pick at least one library, or use Stop sharing', 'warn'); return; } send(save, 'PUT', `/api/plex/shares/${encodeURIComponent(u.shareId)}`, { libraries: v }, `Updated ${u.title}’s libraries`); } }, 'Save');
        mount(editSlot, h('div', { style: { display: 'grid', gap: '8px', marginTop: '8px' } }, p.box, h('div', { style: { display: 'flex', gap: '8px' } }, save, h('button', { class: 'btn sm', onclick: () => mount(editSlot) }, 'Cancel'))));
      } }, 'Change libraries');
      const stop = h('button', { class: 'btn sm danger', onclick: () => {
        if (stop.dataset.armed !== '1') { stop.dataset.armed = '1'; stop.textContent = `Stop sharing with ${u.title}?`; return; }
        send(stop, 'DELETE', `/api/plex/shares/${encodeURIComponent(u.shareId)}`, null, `Stopped sharing with ${u.title}`);
      } }, 'Stop sharing');
      return h('div', { class: 'row', style: { alignItems: 'flex-start', flexWrap: 'wrap' } },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', style: { fontSize: '14px' } }, u.title, ' ', ...badges),
          h('div', { class: 'meta-line' }, u.username ? h('span', { class: 'dim' }, `@${u.username}`) : null, u.email ? h('span', { class: 'dim' }, u.email) : null),
          h('div', { style: { fontSize: '12px', marginTop: '4px' } }, h('b', {}, 'Has: '), libs)),
        h('div', { class: 'row-actions', style: { flexWrap: 'wrap' } }, change, stop), h('div', { style: { flexBasis: '100%' } }, editSlot));
    };
    const shared = d.users.filter((u) => u.shareId); const notShared = d.users.filter((u) => !u.shareId);
    mount(root,
      h('div', { class: 'card', style: { marginBottom: '14px' } },
        h('div', { class: 'section-title', style: { margin: '0 0 8px' } }, 'Invite someone'),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } }, who, inviteBtn),
        h('div', { style: { marginTop: '10px' } }, invLibs.box),
        h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px', marginTop: '10px' } }, dl, 'Allow downloads (Plex’s “download” option)')),
      h('div', { class: 'section-title' }, `Shared with (${shared.length})`),
      shared.length ? h('div', { class: 'list' }, ...shared.map(row)) : h('p', { class: 'dim' }, 'This server isn’t shared with anyone yet.'),
      notShared.length ? h('div', { class: 'section-title', style: { marginTop: '14px' } }, `Plex friends without access (${notShared.length})`) : null,
      notShared.length ? h('div', { class: 'list' }, ...notShared.map(row)) : null,
      h('p', { class: 'dim', style: { fontSize: '12px', marginTop: '10px' } }, 'Changes go to plex.tv with the server owner’s Plex token. Stop sharing removes their access to this server; they stay your Plex friend.'));
  };
  if (!roleAllows('admin')) { mount(root, empty('', 'Admins only', 'Only admins can see and change who the Plex server is shared with.')); return; }
  load();
}
