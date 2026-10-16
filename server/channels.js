// Outbound notification channels: ntfy, Gotify, Discord, Telegram, webhook.
//
// Channels are stored in data/store.json (namespace `notifyChannels`). Secrets
// (tokens, webhook URLs, ntfy credentials) never leave the server: the API
// returns a masked view, and updates keep the stored secret when the client
// sends the mask back. Every send uses redirect:'manual' (a redirect must not
// carry a token elsewhere) and a timeout.
import { randomUUID } from 'node:crypto';
import * as store from './store.js';

const NS = 'notifyChannels';
export const CHANNEL_TYPES = ['ntfy', 'gotify', 'discord', 'telegram', 'webhook'];
export const MASK = '••••••••';
const SECRET_FIELDS = { ntfy: ['token', 'password'], gotify: ['token'], discord: ['webhookUrl'], telegram: ['botToken'], webhook: ['url', 'authHeader'] };
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
  const text = body ? `${title}\n${body}` : title;
  const link = url && /^https?:\/\//.test(url) ? url : '';
  if (c.type === 'ntfy') {
    const headers = { 'content-type': 'application/json' };
    if (c.token) headers.authorization = `Bearer ${c.token}`;
    else if (c.username || c.password) headers.authorization = `Basic ${Buffer.from(`${c.username}:${c.password}`).toString('base64')}`;
    // Optional action buttons (e.g. Approve/Decline): each POSTs to a
    // signed single-use URL on this server. ntfy allows up to 3.
    const ntfyActions = (msg.actions || []).slice(0, 3).map((a) => ({ action: 'http', label: a.label, url: a.url, method: 'POST', clear: true }));
    return { url: c.server.replace(/\/+$/, ''), init: { method: 'POST', headers, body: JSON.stringify({ topic: c.topic, title, message: body || title, priority: c.priority, tags: category ? [category] : [], ...(link ? { click: link } : {}), ...(ntfyActions.length ? { actions: ntfyActions } : {}) }) } };
  }
  if (c.type === 'gotify') {
    return { url: `${c.server.replace(/\/+$/, '')}/message`, init: { method: 'POST', headers: { 'content-type': 'application/json', 'x-gotify-key': c.token }, body: JSON.stringify({ title, message: body || title, priority: c.priority, ...(link ? { extras: { 'client::notification': { click: { url: link } } } } : {}) }) } };
  }
  if (c.type === 'discord') {
    return { url: c.webhookUrl, init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'Arr Command Center', embeds: [{ title: title.slice(0, 256), description: (body || '').slice(0, 4000), ...(link ? { url: link } : {}), color: 0x7c3aed, timestamp: new Date().toISOString() }] }) } };
  }
  if (c.type === 'telegram') {
    return { url: `https://api.telegram.org/bot${c.botToken}/sendMessage`, init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: c.chatId, text: text.slice(0, 4000), disable_web_page_preview: true }) } };
  }
  const headers = { 'content-type': 'application/json' };
  if (c.authHeader) headers.authorization = c.authHeader;
  return { url: c.url, init: { method: 'POST', headers, body: JSON.stringify({ source: 'arr-command-center', title, body, url: link || url || '', category: category || '', at: new Date().toISOString() }) } };
}

// Errors never include the request URL (Telegram/Discord tokens live in it).
async function sendOne(c, msg, fetchImpl) {
  const { url, init } = buildRequest(c, msg);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetchImpl(url, { ...init, redirect: 'manual', signal: controller.signal });
    if (r.status >= 300) return { ok: false, error: r.status >= 300 && r.status < 400 ? `Redirected (HTTP ${r.status})` : `HTTP ${r.status}` };
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
export async function sendToChannels(msg, { globalEnabled = () => true, only = null, fetchImpl = globalThis.fetch } = {}) {
  const list = listChannels().filter((c) => (only ? c.id === only : wants(c, msg.category, globalEnabled(msg.category))));
  const results = await Promise.all(list.map(async (c) => ({ id: c.id, name: c.name, type: c.type, ...(await sendOne(c, msg, fetchImpl)) })));
  return { sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}
