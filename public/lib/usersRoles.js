// Settings → Users & roles (admin only, Sign in with Plex). Lists who may sign
// in and their role, and lets an admin add, change or remove users. The server
// enforces the roles; this card only edits the list.
import { h, mount, toast, confirmModal } from './ui.js';
import { api } from './api.js';

export const ROLE_INFO = {
  admin: 'Everything, including settings, services, users and deleting.',
  user: 'Browse, request, search and manage downloads. No settings or deleting.',
  guest: 'Read-only.',
};

// Role of the signed-in person from /api/config. Without Plex sign-in there is
// one operator, so they are an admin.
export function currentRole(config) {
  const auth = config && config.auth;
  if (!auth || !auth.plexEnabled) return 'admin';
  return auth.role || 'guest';
}
export const isAdmin = (config) => currentRole(config) === 'admin';

// Through api.js, so role changes can ask "Confirm it's you" first.
const call = (method, url, body) => (method === 'GET' ? api.getJson(url) : api.sendJson(url, body || {}, method));

function roleSelect(value, onChange, disabled) {
  const sel = h('select', { class: 'input', style: { width: 'auto' }, disabled: disabled ? 'disabled' : null, 'aria-label': 'Role' },
    ...Object.keys(ROLE_INFO).map((r) => h('option', { value: r, selected: r === value ? 'selected' : null }, r)));
  sel.addEventListener('change', () => onChange(sel.value, sel));
  return sel;
}

export function usersRolesCard() {
  const card = h('div', { class: 'card', id: 'users-panel' }, h('div', { class: 'dim' }, 'Loading…'));
  const render = (data) => {
    if (!data.enabled) {
      mount(card, h('p', { class: 'dim settings-copy' }, 'Roles apply when Sign in with Plex is turned on (auth.plex.enabled in config.json). Without it, anyone who can open the dashboard is an admin.'));
      return;
    }
    const list = h('div', { class: 'list' }, ...data.users.map((u) => {
      const me = data.me && u.id === String(data.me).toLowerCase();
      const fromConfig = u.source === 'config' && !u.overridden;
      return h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, u.id, me ? h('span', { class: 'pill info', style: { marginLeft: '8px' } }, 'you') : null),
          h('div', { class: 'meta-line' },
            h('span', {}, ROLE_INFO[u.role]),
            u.source === 'config' ? h('span', { class: 'pill muted' }, u.overridden ? 'config.json, role changed here' : 'config.json') : null),
        ),
        h('div', { class: 'row-actions' },
          roleSelect(u.role, async (role, sel) => {
            try { render({ ...data, ...(await call('POST', '/api/users', { id: u.id, role })) }); toast(`${u.id} is now ${role}`, 'success'); }
            catch (e) { sel.value = u.role; if (!e.cancelled) toast(e.message, 'error'); }
          }, me),
          fromConfig || me ? null : h('button', { class: 'btn sm danger', onclick: () => confirmModal({
            title: 'Remove user', message: `${u.id} will be signed out and can no longer sign in.`, confirmLabel: 'Remove', danger: true,
            onConfirm: async () => { try { render({ ...data, ...(await call('DELETE', `/api/users/${encodeURIComponent(u.id)}`)) }); } catch (e) { if (!e.cancelled) toast(e.message, 'error'); } },
          }) }, 'Remove'),
        ),
      );
    }));
    const listId = 'users-suggest';
    const idInput = h('input', { class: 'input', placeholder: 'Plex username or email', list: listId, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', style: { flex: '1', minWidth: '0' } });
    let newRole = 'user';
    const add = async () => {
      const id = idInput.value.trim();
      if (!id) return;
      try { render({ ...data, ...(await call('POST', '/api/users', { id, role: newRole })) }); toast(`Added ${id}`, 'success'); }
      catch (e) { if (!e.cancelled) toast(e.message, 'error'); }
    };
    idInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    mount(card,
      h('p', { class: 'dim settings-copy' }, 'Who can sign in with Plex, and what they can do. Changes apply on their next request.'),
      h('div', { class: 'meta-line', style: { margin: '0 0 10px' } }, ...Object.entries(ROLE_INFO).map(([r, d]) => h('span', {}, h('b', {}, r), ` — ${d}`))),
      list,
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' } },
        idInput, roleSelect(newRole, (r) => { newRole = r; }), h('button', { class: 'btn primary sm', onclick: add }, 'Add')),
      h('datalist', { id: listId }, ...(data.suggestions || []).map((s) => h('option', { value: s }))),
      data.allowAny ? h('p', { class: 'dim settings-copy' }, `Any Plex account may sign in (allowAnyPlexUser); people not listed here get the ${data.defaultRole} role.`) : null,
      servicesPanel,
    );
  };
  const servicesPanel = roleServicesPanel();
  call('GET', '/api/users').then(render).catch((e) => mount(card, h('div', { class: 'dim' }, `Could not load users: ${e.message}`)));
  return card;
}

// Which services users and guests see. Admins always see everything.
function roleServicesPanel() {
  const box = h('div', { style: { marginTop: '18px' } });
  const load = async () => {
    let d;
    try { d = await call('GET', '/api/users/services'); } catch (e) { mount(box, h('div', { class: 'dim' }, e.message)); return; }
    const state = { user: d.settings.user, guest: d.settings.guest };
    const save = async (role) => {
      try { await call('PUT', '/api/users/services', { [role]: state[role] }); toast(`${role === 'user' ? 'Users' : 'Guests'} now see ${state[role] === null ? 'every service' : `${state[role].length} ${state[role].length === 1 ? 'service' : 'services'}`}`, 'success'); paint(); }
      catch (e) { if (!e.cancelled) toast(e.message, 'error'); }
    };
    const col = (role) => {
      const all = state[role] === null;
      const chosen = new Set(all ? d.services.map((s) => s.key) : state[role]);
      const every = h('input', { type: 'checkbox', role: 'switch', checked: all ? 'checked' : null, onchange: (e) => { state[role] = e.target.checked ? null : d.services.map((s) => s.key); save(role); } });
      return h('div', { style: { flex: '1', minWidth: '240px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 6px' } }, h('b', {}, role === 'user' ? 'Users' : 'Guests'), h('span', { style: { flex: '1' } }),
          h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' } }, every, 'All services')),
        all ? h('p', { class: 'dim', style: { fontSize: '12px', margin: '0' } }, 'Sees every service, including ones you add later.') :
          h('div', { style: { display: 'grid', gap: '4px', maxHeight: '240px', overflowY: 'auto' } }, ...d.services.map((s) => h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px' } },
            h('input', { type: 'checkbox', checked: chosen.has(s.key) ? 'checked' : null, onchange: (e) => { if (e.target.checked) chosen.add(s.key); else chosen.delete(s.key); state[role] = d.services.map((x) => x.key).filter((k) => chosen.has(k)); save(role); } }),
            s.label, h('span', { class: 'dim', style: { fontSize: '11px' } }, s.type)))));
    };
    const paint = () => mount(box,
      h('div', { class: 'section-title', style: { margin: '0 0 6px' } }, 'Services each role can see'),
      h('p', { class: 'dim settings-copy' }, 'Hidden services disappear from the sidebar, Home and search for that role, and the server refuses their requests. Admins always see everything.'),
      h('div', { style: { display: 'flex', gap: '20px', flexWrap: 'wrap' } }, col('user'), col('guest')));
    paint();
  };
  load();
  return box;
}
