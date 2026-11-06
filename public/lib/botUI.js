// Settings → Chat requests (admins): Telegram and Discord bots, and who is
// allowed to use them with which role.
import { h, mount, toast, fmtRelative } from './ui.js';
import { api } from './api.js';

const ROLES = [['guest', 'Guest (search only)'], ['user', 'User (can request)'], ['admin', 'Admin (can request)']];
const field = (label, input, hint) => h('label', { style: { display: 'grid', gap: '4px', fontSize: '13px' } }, h('span', {}, label), input, hint ? h('span', { class: 'dim', style: { fontSize: '11px' } }, hint) : null);

export function botCard() {
  const card = h('div', { class: 'card', id: 'bot-panel' }, h('div', { class: 'dim' }, 'Loading…'));
  const put = async (path, body, msg) => { try { await api.sendJson(path, body, 'PUT'); if (msg) toast(msg, 'success'); load(); } catch (e) { toast(e.message, 'error'); } };

  async function load() {
    let d;
    try { d = await api.getJson('/api/bot'); } catch (e) { mount(card, h('div', { class: 'dim' }, e.message)); return; }
    const tgToken = h('input', { class: 'input', type: 'password', value: d.telegram.botToken, placeholder: '123456:ABC… from @BotFather', autocomplete: 'off' });
    const tgOn = h('input', { type: 'checkbox', role: 'switch', checked: d.telegram.enabled ? 'checked' : null });
    const st = d.telegram.status || {};
    const dcApp = h('input', { class: 'input', value: d.discord.appId, placeholder: 'Application ID' });
    const dcKey = h('input', { class: 'input', value: d.discord.publicKey, placeholder: 'Public key' });
    const dcTok = h('input', { class: 'input', type: 'password', value: d.discord.botToken, placeholder: 'Bot token (only to register commands)', autocomplete: 'off' });
    const dcOn = h('input', { type: 'checkbox', role: 'switch', checked: d.discord.enabled ? 'checked' : null });
    const url = `${location.origin}${d.interactionsPath}`;
    const seerrSel = d.seerrs.length > 1 ? h('select', { class: 'input', style: { width: 'auto' }, onchange: (e) => put('/api/bot', { seerrKey: e.target.value }, 'Saved') }, ...d.seerrs.map((s) => h('option', { value: s.key, selected: s.key === d.seerrKey ? 'selected' : null }, s.label))) : null;
    const seerrUserSel = (cur, onChange) => h('select', { class: 'input', style: { width: 'auto' }, onchange: (e) => onChange(e.target.value) },
      h('option', { value: '' }, 'Request as the Seerr admin'), ...d.seerrUsers.map((u) => h('option', { value: String(u.id), selected: Number(cur) === u.id ? 'selected' : null }, `Request as ${u.name}`)));
    const roleSel = (cur, onChange) => h('select', { class: 'input', style: { width: 'auto' }, onchange: (e) => onChange(e.target.value) }, ...ROLES.map(([v, l]) => h('option', { value: v, selected: v === cur ? 'selected' : null }, l)));

    mount(card,
      h('div', { class: 'dim', style: { fontSize: '13px', marginBottom: '10px' } }, 'Let people search and request through Seerr from Telegram or Discord with /search, /request and /status. Nobody can use the bot until you allow their chat below.'),
      !d.seerrs.length ? h('p', { class: 'pill warn' }, 'Add Seerr (Overseerr/Jellyseerr) first; requests go through it.') : null,
      seerrSel ? h('div', { style: { margin: '0 0 10px' } }, 'Send requests to ', seerrSel) : null,
      h('div', { class: 'section-title', style: { margin: '6px 0' } }, 'Telegram'),
      h('div', { style: { display: 'grid', gap: '8px' } },
        field('Bot token', tgToken, 'Create a bot with @BotFather. Arr Command Center asks Telegram for new messages, so no public address is needed. Use a bot that nothing else reads messages from.'),
        h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
          h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, tgOn, 'On'),
          h('button', { class: 'btn sm primary', onclick: () => put('/api/bot', { telegram: { enabled: tgOn.checked, botToken: tgToken.value } }, 'Telegram saved') }, 'Save'),
          h('span', { class: `pill ${st.state === 'polling' ? 'ok' : st.state === 'error' ? 'down' : 'muted'}` }, st.state === 'polling' ? `Running${st.username ? ` as @${st.username}` : ''}` : st.state === 'error' ? st.error : 'Off'))),
      h('div', { class: 'section-title', style: { margin: '14px 0 6px' } }, 'Discord'),
      h('div', { style: { display: 'grid', gap: '8px' } },
        h('p', { class: 'dim', style: { fontSize: '12px', margin: '0' } }, 'Discord sends slash commands to this server, so it must be reachable from the internet over https (for example through a reverse proxy or Cloudflare Tunnel). In the Discord developer portal, set Interactions Endpoint URL to:'),
        h('code', { class: 'mono', style: { fontSize: '12px', wordBreak: 'break-all' } }, url),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' } }, dcApp, dcKey, dcTok),
        h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
          h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, dcOn, 'On'),
          h('button', { class: 'btn sm primary', onclick: () => put('/api/bot', { discord: { enabled: dcOn.checked, appId: dcApp.value, publicKey: dcKey.value, botToken: dcTok.value } }, 'Discord saved') }, 'Save'),
          h('button', { class: 'btn sm', onclick: async () => { try { const r = await api.sendJson('/api/bot/discord/register', {}); toast(`Registered ${r.commands} slash commands`, 'success'); } catch (e) { toast(e.message, 'error'); } } }, 'Register slash commands'))),
      d.pending.length ? h('div', {}, h('div', { class: 'section-title', style: { margin: '14px 0 6px' } }, `Waiting to be allowed (${d.pending.length})`),
        h('div', { class: 'list' }, ...d.pending.map((p) => h('div', { class: 'row' },
          h('div', { class: 'row-main' }, h('div', { class: 'row-title', style: { fontSize: '13px' } }, p.name || 'Unknown', ' ', h('span', { class: 'pill muted' }, p.platform)), h('div', { class: 'dim', style: { fontSize: '12px' } }, `id ${p.id} · ${fmtRelative(p.at)}`)),
          h('div', { class: 'row-actions' },
            h('button', { class: 'btn sm primary', onclick: () => put('/api/bot/users', { platform: p.platform, id: p.id, name: p.name, role: 'user' }, `${p.name || p.id} can now request`) }, 'Allow requests'),
            h('button', { class: 'btn sm', onclick: () => put('/api/bot/users', { platform: p.platform, id: p.id, name: p.name, role: 'guest' }, `${p.name || p.id} can search`) }, 'Search only'),
            h('button', { class: 'btn sm', onclick: async () => { await fetch(`/api/bot/users/${p.platform}/${encodeURIComponent(p.id)}`, { method: 'DELETE' }); load(); } }, 'Ignore')))))) : null,
      h('div', { class: 'section-title', style: { margin: '14px 0 6px' } }, 'Allowed chats'),
      d.users.length ? h('div', { class: 'list' }, ...d.users.map((u) => {
        const upd = (patch) => put('/api/bot/users', { ...u, ...patch }, 'Saved');
        return h('div', { class: 'row', style: { flexWrap: 'wrap' } },
          h('div', { class: 'row-main' }, h('div', { class: 'row-title', style: { fontSize: '13px' } }, u.name || u.id, ' ', h('span', { class: 'pill muted' }, u.platform)), h('div', { class: 'dim', style: { fontSize: '12px' } }, `id ${u.id}`)),
          h('div', { class: 'row-actions', style: { flexWrap: 'wrap' } }, roleSel(u.role, (role) => upd({ role })), d.seerrUsers.length ? seerrUserSel(u.seerrUserId, (v) => upd({ seerrUserId: v || null })) : null,
            h('button', { class: 'btn sm danger', onclick: async () => { await fetch(`/api/bot/users/${u.platform}/${encodeURIComponent(u.id)}`, { method: 'DELETE' }); load(); } }, 'Remove')));
      })) : h('div', { class: 'dim', style: { fontSize: '13px' } }, 'None yet. Message the bot from the chat you want to allow; it will show up above.'));
  }
  load();
  return card;
}
