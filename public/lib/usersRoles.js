// Settings → Users & roles (admin only, Sign in with Plex). Lists who may sign
// in and their role, and lets an admin add, change or remove users. The server
// enforces the roles; this card only edits the list.
import { h, mount, toast, confirmModal } from './ui.js';

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

async function call(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

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
            catch (e) { sel.value = u.role; toast(e.message, 'error'); }
          }, me),
          fromConfig || me ? null : h('button', { class: 'btn sm danger', onclick: () => confirmModal({
            title: 'Remove user', message: `${u.id} will be signed out and can no longer sign in.`, confirmLabel: 'Remove', danger: true,
            onConfirm: async () => { try { render({ ...data, ...(await call('DELETE', `/api/users/${encodeURIComponent(u.id)}`)) }); } catch (e) { toast(e.message, 'error'); } },
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
      catch (e) { toast(e.message, 'error'); }
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
    );
  };
  call('GET', '/api/users').then(render).catch((e) => mount(card, h('div', { class: 'dim' }, `Could not load users: ${e.message}`)));
  return card;
}
