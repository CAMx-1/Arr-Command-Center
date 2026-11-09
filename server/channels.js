// Outbound notification channels: ntfy, Gotify, Discord, Telegram, webhook,
// email (SMTP), Pushover, Slack, Matrix and Apprise.
//
// Channels are stored in data/store.json (namespace `notifyChannels`). Secrets
// (tokens, webhook URLs, ntfy credentials) never leave the server: the API
// returns a masked view, and updates keep the stored secret when the client
// sends the mask back. Every send uses redirect:'manual' (a redirect must not
// carry a token elsewhere) and a timeout.
import { randomUUID } from 'node:crypto';
import * as store from './store.js';
import { sendMail, buildMessage, isEmail } from './smtp.js';

const NS = 'notifyChannels';
export const CHANNEL_TYPES = ['ntfy', 'gotify', 'discord', 'telegram', 'webhook', 'email', 'pushover', 'slack', 'matrix', 'apprise'];
export const MASK = '••••••••';
const SECRET_FIELDS = { ntfy: ['token', 'password'], gotify: ['token'], discord: ['webhookUrl'], telegram: ['botToken'], webhook: ['url', 'authHeader'], email: ['password'], pushover: ['appToken', 'userKey'], slack: ['webhookUrl'], matrix: ['accessToken'], apprise: ['urls'] };
const SMTP_PORTS = { tls: 465, starttls: 587, none: 25 };
const TIMEOUT_MS = 10000;
const MAX = 20;

const str = (v, n = 500) => (v == null ? '' : String(v).trim().slice(0, n));
const isHttpUrl = (u) => { try { const p = new URL(u).protocol; return p === 'http:' || p === 'https:'; } catch { return false; } };

// Validate + normalize user input for a channel (secrets may be MASK = keep).
export function normalizeChannel(input, prev = null) {
  const type = str(input.type, 20);
  if (!CHANNEL_TYPES.includes(type)) return { error: 'Unknown channel type' };
  const keep = (field) => (input[field] === MASK && prev && prev.type === type ? prev[field] : str(input[field], 2000));
  const c = {
    id: prev ? prev.id : randomUUID(),
    type,
    name: str(input.name, 60) || type,
    enabled: input.enabled !== false,
    // Categories this channel receives; empty = follow the global push prefs.
    categories: Array.isArray(input.categories) ? input.categories.map((x) => str(x, 30)).filter(Boolean).slice(0, 20) : [],
  };
  if (type === 'ntfy') {
    c.server = str(input.server, 300) || 'https://ntfy.sh';
    c.topic = str(input.topic, 120);
    c.token = keep('token'); c.username = str(input.username, 120); c.password = keep('password');
    c.priority = Math.min(5, Math.max(1, Number(input.priority) || 3));
    if (!isHttpUrl(c.server)) return { error: 'ntfy server must be an http(s) URL' };
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(c.topic)) return { error: 'ntfy topic: letters, numbers, - and _ only' };
  } else if (type === 'gotify') {
    c.server = str(input.server, 300); c.token = keep('token');
    c.priority = Math.min(10, Math.max(0, Number(input.priority) ?? 5));
    if (!isHttpUrl(c.server)) return { error: 'Gotify server must be an http(s) URL' };
    if (!c.token) return { error: 'Gotify app token is required' };
  } else if (type === 'discord') {
    c.webhookUrl = keep('webhookUrl');
    if (!/^https:\/\/(discord(app)?\.com|ptb\.discord\.com|canary\.discord\.com)\/api\/webhooks\/\d+\/[\w-]+$/.test(c.webhookUrl)) return { error: 'Discord webhook URL looks wrong (Server Settings → Integrations → Webhooks → Copy URL)' };
  } else if (type === 'telegram') {
    c.botToken = keep('botToken'); c.chatId = str(input.chatId, 64);
    if (!/^\d{5,}:[\w-]{20,}$/.test(c.botToken)) return { error: 'Telegram bot token looks wrong (from @BotFather)' };
    if (!/^-?\d{1,20}$|^@[\w]{4,}$/.test(c.chatId)) return { error: 'Telegram chat id must be a number or @channelname' };
  } else if (type === 'webhook') {
    c.url = keep('url'); c.authHeader = keep('authHeader');
    if (!isHttpUrl(c.url)) return { error: 'Webhook URL must be an http(s) URL' };
  } else if (type === 'email') {
    c.host = str(input.host, 253); c.security = ['tls', 'starttls', 'none'].includes(input.security) ? input.security : 'starttls';
    c.port = Number(input.port) || SMTP_PORTS[c.security];
    c.username = str(input.username, 200); c.password = keep('password');
    c.from = str(input.from, 254);
    c.to = (Array.isArray(input.to) ? input.to : String(input.to || '').split(/[,;\s]+/)).map((x) => str(x, 254)).filter(Boolean).slice(0, 10);
    if (!/^[A-Za-z0-9.-]{1,253}$/.test(c.host) && !/^\[[0-9a-f:.]+\]$/i.test(c.host)) return { error: 'SMTP server: a host name like smtp.gmail.com' };
    if (!(c.port >= 1 && c.port <= 65535)) return { error: 'SMTP port must be 1–65535' };
    if (!isEmail(c.from)) return { error: 'From must be an email address' };
    if (!c.to.length || !c.to.every(isEmail)) return { error: 'To: one or more email addresses, separated by commas' };
    if (c.security === 'none' && c.username && !/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(c.host)) return { error: 'A password needs SSL/TLS or STARTTLS (a plain connection would send it unencrypted)' };
  } else if (type === 'pushover') {
    c.appToken = keep('appToken'); c.userKey = keep('userKey'); c.device = str(input.device, 120);
    c.priority = Math.min(1, Math.max(-2, Math.round(Number(input.priority) || 0)));
    if (!/^[A-Za-z0-9]{30}$/.test(c.appToken)) return { error: 'Pushover application token: 30 letters and numbers (pushover.net → Your Applications)' };
    if (!/^[A-Za-z0-9]{30}$/.test(c.userKey)) return { error: 'Pushover user or group key: 30 letters and numbers' };
    if (c.device && !/^[A-Za-z0-9_,-]{1,120}$/.test(c.device)) return { error: 'Pushover device names: letters, numbers, - and _ (comma-separated)' };
  } else if (type === 'slack') {
    c.webhookUrl = keep('webhookUrl');
    if (!/^https:\/\//.test(c.webhookUrl) || !isHttpUrl(c.webhookUrl)) return { error: 'Slack webhook URL must start with https:// (Slack → Apps → Incoming Webhooks)' };
  } else if (type === 'matrix') {
    c.homeserver = str(input.homeserver, 300).replace(/\/+$/, ''); c.roomId = str(input.roomId, 255); c.accessToken = keep('accessToken');
    if (!isHttpUrl(c.homeserver)) return { error: 'Matrix homeserver must be an http(s) URL, like https://matrix.org' };
    if (!/^![^:\s]+:[^\s]+$/.test(c.roomId)) return { error: 'Matrix room id looks like !abc123:matrix.org (room settings → Advanced)' };
    if (!c.accessToken) return { error: 'Matrix access token is required' };
  } else if (type === 'apprise') {
    c.server = str(input.server, 300).replace(/\/+$/, ''); c.key = str(input.key, 128); c.tag = str(input.tag, 200); c.urls = keep('urls');
    if (!isHttpUrl(c.server)) return { error: 'Apprise API server must be an http(s) URL, like http://apprise:8000' };
    if (c.key && !/^[\w-]{1,128}$/.test(c.key)) return { error: 'Apprise configuration key: letters, numbers, - and _' };
    if (!c.key && !c.urls) return { error: 'Give a configuration key saved in Apprise, or Apprise URLs to send to' };
  }
  return { channel: c };
}

// Secret-free view for the browser.
export function publicChannel(c) {
  const out = { ...c };
  for (const f of SECRET_FIELDS[c.type] || []) out[f] = c[f] ? MASK : '';
  // Show where a Discord/webhook goes without the token part.
  if (c.type === 'discord' && c.webhookUrl) out.target = 'discord.com webhook';
  if (c.type === 'webhook' && c.url) { try { out.target = new URL(c.url).host; } catch { out.target = ''; } }
  if (c.type === 'email') out.target = `${(c.to || []).join(', ')} via ${c.host}`;
  if (c.type === 'slack' && c.webhookUrl) { try { out.target = new URL(c.webhookUrl).host; } catch { out.target = ''; } }
  if (c.type === 'matrix') { try { out.target = `${c.roomId} on ${new URL(c.homeserver).host}`; } catch { out.target = c.roomId; } }
  if (c.type === 'apprise') { try { out.target = `${new URL(c.server).host}${c.key ? ` · ${c.key}` : ''}`; } catch { out.target = ''; } }
  if (c.type === 'pushover') out.target = c.device ? `Pushover · ${c.device}` : 'Pushover';
  return out;
}

export function listChannels() { const v = store.get(NS, []); return Array.isArray(v) ? v : []; }
export function listPublic() { return listChannels().map(publicChannel); }
function save(list) { store.set(NS, list.slice(0, MAX)); }

export function upsertChannel(input) {
  const list = listChannels();
  const prev = input.id ? list.find((c) => c.id === input.id) : null;
  if (input.id && !prev) return { error: 'Unknown channel' };
  if (!prev && list.length >= MAX) return { error: `At most ${MAX} channels` };
  const { channel, error } = normalizeChannel(input, prev);
  if (error) return { error };
  save(prev ? list.map((c) => (c.id === prev.id ? channel : c)) : [...list, channel]);
  return { channel: publicChannel(channel) };
}

export function removeChannel(id) {
  const list = listChannels();
  const next = list.filter((c) => c.id !== id);
  save(next);
  return { removed: list.length - next.length };
}

// Build the HTTP request for a channel (pure; exported for tests).
export function buildRequest(c, msg) {
  const { title, body, url, category } = msg;
  const image = msg.image && /^https:\/\//.test(msg.image) ? msg.image : '';
  const text = body ? `${title}\n${body}` : title;
  const link = url && /^https?:\/\//.test(url) ? url : '';
  if (c.type === 'ntfy') {
    const headers = { 'content-type': 'application/json' };
    if (c.token) headers.authorization = `Bearer ${c.token}`;
    else if (c.username || c.password) headers.authorization = `Basic ${Buffer.from(`${c.username}:${c.password}`).toString('base64')}`;
    // Optional action buttons (e.g. Approve/Decline): each POSTs to a
    // signed single-use URL on this server. ntfy allows up to 3.
    const ntfyActions = (msg.actions || []).slice(0, 3).map((a) => ({ action: 'http', label: a.label, url: a.url, method: 'POST', clear: true }));
    return { url: c.server.replace(/\/+$/, ''), init: { method: 'POST', headers, body: JSON.stringify({ topic: c.topic, title, message: body || title, priority: c.priority, tags: category ? [category] : [], ...(link ? { click: link } : {}), ...(image ? { icon: image } : {}), ...(ntfyActions.length ? { actions: ntfyActions } : {}) }) } };
  }
  if (c.type === 'gotify') {
    return { url: `${c.server.replace(/\/+$/, '')}/message`, init: { method: 'POST', headers: { 'content-type': 'application/json', 'x-gotify-key': c.token }, body: JSON.stringify({ title, message: body || title, priority: c.priority, ...(link ? { extras: { 'client::notification': { click: { url: link } } } } : {}) }) } };
  }
  if (c.type === 'discord') {
    return { url: c.webhookUrl, init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'Arr Command Center', embeds: [{ title: title.slice(0, 256), description: (body || '').slice(0, 4000), ...(link ? { url: link } : {}), ...(image ? { thumbnail: { url: image } } : {}), color: 0x7c3aed, timestamp: new Date().toISOString() }] }) } };
  }
  if (c.type === 'telegram') {
    return { url: `https://api.telegram.org/bot${c.botToken}/sendMessage`, init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: c.chatId, text: text.slice(0, 4000), disable_web_page_preview: true }) } };
  }
  if (c.type === 'pushover') {
    const form = new URLSearchParams({ token: c.appToken, user: c.userKey, title: title.slice(0, 250), message: (body || title).slice(0, 1024), priority: String(c.priority || 0) });
    if (c.device) form.set('device', c.device);
    if (link) { form.set('url', link.slice(0, 512)); form.set('url_title', 'Open'); }
    return { url: 'https://api.pushover.net/1/messages.json', init: { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() } };
  }
  if (c.type === 'slack') {
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const textOut = `*${esc(title)}*${body ? `\n${esc(body)}` : ''}${link ? `\n<${link}|Open>` : ''}`.slice(0, 3900);
    return { url: c.webhookUrl, init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: textOut }) } };
  }
  if (c.type === 'matrix') {
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const html = `<b>${esc(title)}</b>${body ? `<br>${esc(body).replace(/\n/g, '<br>')}` : ''}${link ? `<br><a href="${esc(link)}">Open</a>` : ''}`;
    const txn = `acc-${Date.now()}-${randomUUID().slice(0, 8)}`;
    return { url: `${c.homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(c.roomId)}/send/m.room.message/${txn}`, init: { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${c.accessToken}` }, body: JSON.stringify({ msgtype: 'm.notice', body: link ? `${text}\n${link}` : text, format: 'org.matrix.custom.html', formatted_body: html }) } };
  }
  if (c.type === 'apprise') {
    const payload = { title, body: (body || title) + (link ? `\n${link}` : ''), type: category === 'failed' || category === 'problem' ? 'warning' : 'info', format: 'text', ...(c.key ? {} : { urls: c.urls }), ...(c.key && c.tag ? { tag: c.tag } : {}) };
    return { url: `${c.server}/notify/${c.key ? encodeURIComponent(c.key) : ''}`, init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) } };
  }
  const headers = { 'content-type': 'application/json' };
  if (c.authHeader) headers.authorization = c.authHeader;
  return { url: c.url, init: { method: 'POST', headers, body: JSON.stringify({ source: 'arr-command-center', title, body, url: link || url || '', category: category || '', at: new Date().toISOString() }) } };
}

// The email for a notification: plain text and simple HTML.
export function emailFor(c, msg) {
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const link = msg.url && /^https?:\/\//.test(msg.url) ? msg.url : '';
  const image = msg.image && /^https:\/\//.test(msg.image) ? msg.image : '';
  const text = `${msg.body || msg.title}${link ? `\n\n${link}` : ''}\n\n— Arr Command Center`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#1f2937">${image ? `<img src="${esc(image)}" alt="" width="120" style="float:right;margin:0 0 8px 12px;border-radius:6px">` : ''}<p style="font-size:17px;font-weight:700;margin:0 0 8px">${esc(msg.title)}</p><p style="margin:0;white-space:pre-line">${esc(msg.body || '')}</p>${link ? `<p><a href="${esc(link)}">Open</a></p>` : ''}<p style="color:#6b7280;font-size:12px;margin-top:18px">Sent by Arr Command Center</p></div>`;
  return buildMessage({ from: c.from, to: c.to, subject: msg.title, text, html });
}

// The service's own words for a failed send, with this channel's secrets
// taken out (some services echo what they were sent).
async function explain(c, r) {
  let detail = '';
  try {
    const raw = typeof r.text === 'function' ? (await r.text()).slice(0, 2000) : '';
    let j = null; try { j = JSON.parse(raw); } catch { /* not JSON */ }
    detail = j ? [].concat(j.errors || [], j.error || [], j.message || [], j.description || []).map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('; ') : (/^[^<]{1,200}$/.test(raw.trim()) ? raw.trim() : '');
  } catch { /* no body */ }
  for (const f of SECRET_FIELDS[c.type] || []) if (c[f] && String(c[f]).length >= 6) detail = detail.split(String(c[f])).join('…');
  return detail ? `HTTP ${r.status}: ${detail.slice(0, 200)}` : `HTTP ${r.status}`;
}

// Errors never include the request URL (Telegram/Discord tokens live in it).
async function sendOne(c, msg, fetchImpl, mailImpl = sendMail) {
  if (c.type === 'email') {
    try { await mailImpl({ host: c.host.replace(/^\[|\]$/g, ''), port: c.port, security: c.security, username: c.username, password: c.password, from: c.from, to: c.to, message: emailFor(c, msg) }); return { ok: true }; }
    catch (e) { let m = String(e.message || 'Could not send'); if (c.password && c.password.length >= 4) m = m.split(c.password).join('…'); return { ok: false, error: m.slice(0, 200) }; }
  }
  const { url, init } = buildRequest(c, msg);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetchImpl(url, { ...init, redirect: 'manual', signal: controller.signal });
    if (r.status >= 300) return { ok: false, error: r.status < 400 ? `Redirected (HTTP ${r.status})` : await explain(c, r) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'Timed out' : 'Could not connect' };
  } finally { clearTimeout(timer); }
}

export function wants(c, category, globalEnabled) {
  if (!c.enabled) return false;
  if (!category || category === 'test') return true;
  return c.categories.length ? c.categories.includes(category) : globalEnabled;
}

// Send to every matching channel. globalEnabled(category) = the push prefs.
export async function sendToChannels(msg, { globalEnabled = () => true, only = null, fetchImpl = globalThis.fetch, mailImpl = sendMail } = {}) {
  const list = listChannels().filter((c) => (only ? c.id === only : wants(c, msg.category, globalEnabled(msg.category))));
  const results = await Promise.all(list.map(async (c) => ({ id: c.id, name: c.name, type: c.type, ...(await sendOne(c, msg, fetchImpl, mailImpl)) })));
  return { sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}
