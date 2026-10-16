// Settings → Notifications → Channels: ntfy, Gotify, Discord, Telegram and
// webhook targets the server sends alerts to (alongside browser push). Works
// for the native iOS app too: install the ntfy app and subscribe to a topic.
// Secrets come back masked from the server; leaving a masked field unchanged
// keeps the stored value.
import { h, mount, toast, confirmModal, openModal, closeModal } from './ui.js';

const MASK = '••••••••';
const TYPE_INFO = {
  ntfy: { label: 'ntfy', hint: 'Push to the ntfy app (iOS/Android/desktop). Use ntfy.sh or your own server; pick a hard-to-guess topic.' },
  gotify: { label: 'Gotify', hint: 'Your Gotify server URL and an application token (Apps → Create application).' },
  discord: { label: 'Discord', hint: 'Channel → Edit → Integrations → Webhooks → New webhook → Copy URL.' },
  telegram: { label: 'Telegram', hint: 'Create a bot with @BotFather for the token; message the bot, then use your chat id (e.g. from @userinfobot).' },
  webhook: { label: 'Webhook', hint: 'POSTs JSON { title, body, url, category, at } to your URL (Home Assistant, n8n, …).' },
};
const FIELDS = {
  ntfy: [['server', 'Server', 'https://ntfy.sh'], ['topic', 'Topic', 'arr-alerts-x7k2'], ['token', 'Access token (optional)', '', true], ['username', 'Username (optional)', ''], ['password', 'Password (optional)', '', true], ['priority', 'Priority (1–5)', '3']],
  gotify: [['server', 'Server', 'https://gotify.example.com'], ['token', 'App token', '', true], ['priority', 'Priority (0–10)', '5']],
  discord: [['webhookUrl', 'Webhook URL', 'https://discord.com/api/webhooks/…', true]],
  telegram: [['botToken', 'Bot token', '123456:ABC…', true], ['chatId', 'Chat id', '-1001234567890']],
  webhook: [['url', 'URL', 'https://hooks.example.com/arr', true], ['authHeader', 'Authorization header (optional)', 'Bearer …', true]],
};

async function call(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

export function channelsCard() {
  const card = h('div', { class: 'card notify-channels', id: 'notify-channels' }, h('div', { class: 'dim' }, 'Loading channels…'));
  const render = async () => {
    let data;
    try { data = await call('GET', '/api/notify/channels'); } catch (e) { mount(card, h('div', { class: 'dim' }, `Could not load channels: ${e.message}`)); return; }
    const { channels, categories } = data;
    const catLabel = Object.fromEntries(categories.map((c) => [c.id, c.label]));
    const rows = channels.map((c) => {
      const test = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
        test.disabled = true; test.textContent = 'Sending…';
        try { const r = await call('POST', `/api/notify/channels/${encodeURIComponent(c.id)}/test`); toast(r.ok ? `Sent to ${c.name}` : `${c.name}: ${r.error}`, r.ok ? 'success' : 'error'); }
        catch (e) { toast(e.message, 'error'); }
        test.disabled = false; test.textContent = 'Test';
      } }, 'Test');
      return h('div', { class: 'notify-channel-row' },
        h('div', { class: 'notify-channel-main' },
          h('strong', {}, c.name),
          h('div', { class: 'meta-line' },
            h('span', { class: 'pill muted' }, TYPE_INFO[c.type]?.label || c.type),
            c.enabled ? null : h('span', { class: 'pill warn' }, 'Off'),
            h('span', { class: 'dim' }, c.topic ? `topic ${c.topic}` : c.target || c.server || c.chatId || ''),
            h('span', { class: 'dim' }, c.categories.length ? c.categories.map((x) => catLabel[x] || x).join(', ') : 'Same as push settings'))),
        h('div', { class: 'notify-channel-actions' },
          test,
          h('button', { class: 'btn sm', type: 'button', onclick: () => openEditor(c) }, 'Edit'),
          h('button', { class: 'btn sm danger', type: 'button', 'aria-label': `Remove ${c.name}`, onclick: () => confirmModal({
            title: 'Remove channel', message: `Stop sending notifications to “${c.name}”?`, confirmLabel: 'Remove', danger: true,
            onConfirm: async () => { try { await call('DELETE', `/api/notify/channels/${encodeURIComponent(c.id)}`); render(); } catch (e) { toast(e.message, 'error'); } },
          }) }, 'Remove')));
    });
    const addSel = h('select', { class: 'input', 'aria-label': 'Channel type' }, ...Object.entries(TYPE_INFO).map(([k, v]) => h('option', { value: k }, v.label)));
    mount(card,
      h('h3', {}, 'Notification channels'),
      h('p', { class: 'dim settings-copy' }, 'Also send alerts to ntfy, Gotify, Discord, Telegram or a webhook. On iPhone, the free ntfy app gives the native app real push notifications.'),
      rows.length ? h('div', { class: 'notify-channel-list' }, ...rows) : h('div', { class: 'dim', style: { margin: '6px 0 10px' } }, 'No channels yet.'),
      h('div', { class: 'notify-channel-add' }, addSel, h('button', { class: 'btn sm primary', type: 'button', onclick: () => openEditor({ type: addSel.value, enabled: true, categories: [] }) }, '+ Add channel')));

    function openEditor(c) {
      const isNew = !c.id;
      const inputs = {};
      const fields = FIELDS[c.type].map(([key, label, ph, secret]) => {
        const el = h('input', { class: 'input', type: secret ? 'password' : 'text', autocomplete: 'off', spellcheck: 'false', placeholder: ph, value: c[key] != null ? String(c[key]) : (key === 'server' && c.type === 'ntfy' ? 'https://ntfy.sh' : '') });
        if (secret && c[key] === MASK) el.placeholder = 'Saved — leave blank to keep';
        if (secret && c[key] === MASK) el.value = '';
        inputs[key] = el;
        return h('label', { class: 'quick-add-field' }, h('span', { class: 'quick-add-label' }, label), el);
      });
      const name = h('input', { class: 'input', type: 'text', value: c.name || TYPE_INFO[c.type].label, maxlength: '60' });
      const enabled = h('input', { type: 'checkbox', checked: c.enabled !== false ? 'checked' : null });
      const catBoxes = categories.map((cat) => { const b = h('input', { type: 'checkbox', value: cat.id, checked: c.categories.includes(cat.id) ? 'checked' : null }); return [b, h('label', {}, b, ` ${cat.label}`)]; });
      const save = async () => {
        const body = { id: c.id, type: c.type, name: name.value, enabled: enabled.checked, categories: catBoxes.filter(([b]) => b.checked).map(([b]) => b.value) };
        for (const [key, , , secret] of FIELDS[c.type]) body[key] = secret && !inputs[key].value && c[key] === MASK ? MASK : inputs[key].value;
        try { await call('POST', '/api/notify/channels', body); closeModal(); toast(isNew ? 'Channel added — tap Test to try it' : 'Channel saved', 'success'); render(); }
        catch (e) { toast(e.message, 'error'); }
      };
      openModal({
        title: `${isNew ? 'Add' : 'Edit'} ${TYPE_INFO[c.type].label} channel`,
        body: h('div', { class: 'quick-add-panel notify-editor' },
          h('div', { class: 'quick-add-hint' }, TYPE_INFO[c.type].hint),
          h('label', { class: 'quick-add-field' }, h('span', { class: 'quick-add-label' }, 'Name'), name),
          ...fields,
          h('div', { class: 'quick-add-label' }, 'Send'),
          h('div', { class: 'quick-add-checks notify-cats' }, ...catBoxes.map(([, l]) => l)),
          h('div', { class: 'quick-add-hint dim' }, 'None ticked = follow the browser-push category settings above.'),
          h('div', { class: 'quick-add-checks' }, h('label', {}, enabled, ' Enabled'))),
        footer: h('div', { style: { display: 'flex', gap: '10px' } }, h('button', { class: 'btn', type: 'button', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Save')),
      });
    }
  };
  render();
  return card;
}
