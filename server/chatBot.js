// Two-way chat requests: /search, /request and /status from Telegram (long
// polling, no public URL needed) and Discord (slash commands through an
// interactions endpoint, which Discord must be able to reach). Requests go
// to Seerr with the server's key, attributed to the linked Seerr user.
//
// Nobody can use the bot until an admin links their chat: an unknown chat
// gets its id back and lands in a "waiting" list in Settings. A linked chat
// has a role: guest can search and check status, user and admin can request.
import { createPublicKey, verify as edVerify } from 'node:crypto';
import { serviceGet, serviceRequest } from './proxy.js';

export const MASK = '••••••••';
const NS = 'bot';
const MAX_PENDING = 20;
const MAX_LIST = 5;
const SEERR_STATUS = { 1: 'unknown', 2: 'requested', 3: 'being downloaded', 4: 'partly available', 5: 'available', 6: 'blocklisted', 7: 'deleted' };
const REQ_STATUS = { 1: 'waiting for approval', 2: 'approved', 3: 'declined', 4: 'failed', 5: 'completed' };

const year = (r) => String(r.releaseDate || r.firstAirDate || '').slice(0, 4);
const titleOf = (r) => `${r.title || r.name}${year(r) ? ` (${year(r)})` : ''}`;
const kindOf = (r) => (r.mediaType === 'tv' ? 'TV' : 'Movie');

export function defaultSettings() {
  return { telegram: { enabled: false, botToken: '' }, discord: { enabled: false, appId: '', publicKey: '', botToken: '' }, seerrKey: '', users: [], pending: [], last: {}, history: {} };
}

// Parse "/request@MyBot dune 2021" -> { cmd: 'request', arg: 'dune 2021' }.
export function parseCommand(text) {
  const m = /^\/([a-z]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(String(text || '').trim());
  return m ? { cmd: m[1].toLowerCase(), arg: (m[2] || '').trim() } : null;
}

const HELP = [
  '/search <title> — look something up',
  '/request <title> — request a movie or show (or /request 2 to pick from the last list)',
  '/status — your recent requests',
].join('\n');

export function createBotCore({ cfg, store, get = serviceGet, send = serviceRequest, now = () => Date.now() }) {
  const settings = () => ({ ...defaultSettings(), ...store.get(NS, {}) });
  const save = (s) => store.set(NS, s);
  const seerrSvc = () => {
    const s = settings();
    const list = Object.entries(cfg.services || {}).filter(([, v]) => v.type === 'overseerr');
    const hit = list.find(([k]) => k === s.seerrKey) || list[0];
    return hit ? { ...hit[1], key: hit[0] } : null;
  };
  const who = (platform, id) => settings().users.find((u) => u.platform === platform && String(u.id) === String(id));

  function notePending(platform, id, name) {
    const s = settings();
    if (s.users.some((u) => u.platform === platform && String(u.id) === String(id))) return;
    s.pending = [{ platform, id: String(id), name: String(name || '').slice(0, 60), at: new Date(now()).toISOString() }, ...s.pending.filter((p) => !(p.platform === platform && p.id === String(id)))].slice(0, MAX_PENDING);
    save(s);
  }

  async function search(q) {
    const svc = seerrSvc();
    if (!svc) throw new Error('Seerr isn’t set up in Arr Command Center.');
    const d = await get(svc, `api/v1/search?query=${encodeURIComponent(q).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}&page=1`);
    return ((d && d.results) || []).filter((r) => r.mediaType === 'movie' || r.mediaType === 'tv').slice(0, MAX_LIST);
  }

  const listText = (results) => results.map((r, i) => `${i + 1}. ${titleOf(r)} · ${kindOf(r)}${r.mediaInfo && SEERR_STATUS[r.mediaInfo.status] && r.mediaInfo.status > 1 ? ` · ${SEERR_STATUS[r.mediaInfo.status]}` : ''}`).join('\n');

  async function request(user, r) {
    const svc = seerrSvc();
    const st = r.mediaInfo && r.mediaInfo.status;
    if (st === 5) return `${titleOf(r)} is already available.`;
    if (st === 2 || st === 3 || st === 4) return `${titleOf(r)} is already ${SEERR_STATUS[st]}.`;
    const body = { mediaType: r.mediaType, mediaId: r.id, ...(r.mediaType === 'tv' ? { seasons: 'all' } : {}), ...(user.seerrUserId ? { userId: Number(user.seerrUserId) } : {}) };
    let made;
    try { made = await send(svc, 'api/v1/request', { method: 'POST', body }); }
    catch (e) {
      if (e.status === 409) return `${titleOf(r)} has already been requested.`;
      const msg = e.body && (e.body.message || e.body.error);
      return `Couldn’t request ${titleOf(r)}${msg ? `: ${msg}` : ` (${e.message})`}.`;
    }
    const s = settings();
    const key = `${user.platform}:${user.id}`;
    s.history[key] = [{ id: made && made.id, title: titleOf(r), at: new Date(now()).toISOString() }, ...(s.history[key] || [])].slice(0, 10);
    save(s);
    return `Requested ${titleOf(r)}.${made && made.status === 1 ? ' It needs an admin to approve it.' : ''}`;
  }

  // Returns the reply text.
  async function handle({ platform, id, name, text }) {
    const c = parseCommand(text);
    if (!c) return null;
    const user = who(platform, id);
    if (!user) {
      notePending(platform, id, name);
      return `This chat isn’t linked yet. Ask an admin to allow it in Arr Command Center → Settings → Chat requests (${platform} id ${id}).`;
    }
    const canRequest = user.role === 'user' || user.role === 'admin';
    try {
      if (c.cmd === 'start' || c.cmd === 'help') return `Hi ${user.name || 'there'}.\n${canRequest ? HELP : HELP.split('\n').filter((l) => !l.startsWith('/request')).join('\n')}`;
      if (c.cmd === 'search') {
        if (!c.arg) return 'Usage: /search <title>';
        const results = await search(c.arg);
        if (!results.length) return `Nothing found for “${c.arg}”.`;
        const s = settings(); s.last[`${platform}:${id}`] = results.map((r) => ({ id: r.id, mediaType: r.mediaType, title: r.title, name: r.name, releaseDate: r.releaseDate, firstAirDate: r.firstAirDate, mediaInfo: r.mediaInfo ? { status: r.mediaInfo.status } : undefined })); save(s);
        return `${listText(results)}${canRequest ? '\n\nReply /request <number> to request one.' : ''}`;
      }
      if (c.cmd === 'request') {
        if (!canRequest) return 'Your role can search but not request. Ask an admin if you need that.';
        if (!c.arg) return 'Usage: /request <title> or /request <number from your last search>';
        if (/^\d{1,2}$/.test(c.arg)) {
          const last = settings().last[`${platform}:${id}`] || [];
          const pick = last[Number(c.arg) - 1];
          if (!pick) return last.length ? `Pick a number from 1 to ${last.length}.` : 'Search first with /search <title>.';
          // Re-check: it may have been requested since the search.
          const fresh = (await search(pick.title || pick.name)).find((r) => r.id === pick.id && r.mediaType === pick.mediaType) || pick;
          return request(user, fresh);
        }
        const results = await search(c.arg);
        if (!results.length) return `Nothing found for “${c.arg}”.`;
        const exact = results.filter((r) => String(r.title || r.name).toLowerCase() === c.arg.toLowerCase() || titleOf(r).toLowerCase() === c.arg.toLowerCase());
        if (exact.length === 1 || results.length === 1) return request(user, exact[0] || results[0]);
        const s = settings(); s.last[`${platform}:${id}`] = results; save(s);
        return `Which one?\n${listText(results)}\n\nReply /request <number>.`;
      }
      if (c.cmd === 'status') {
        const mine = settings().history[`${platform}:${id}`] || [];
        if (!mine.length) return 'You haven’t requested anything from here yet.';
        const svc = seerrSvc();
        const lines = await Promise.all(mine.slice(0, 5).map(async (h) => {
          const r = h.id ? await get(svc, `api/v1/request/${encodeURIComponent(h.id)}`).catch(() => null) : null;
          const st = r ? (r.media && r.media.status >= 4 ? SEERR_STATUS[r.media.status] : REQ_STATUS[r.status] || 'unknown') : 'not found';
          return `• ${h.title}: ${st}`;
        }));
        return lines.join('\n');
      }
      return `I don’t know /${c.cmd}.\n${HELP}`;
    } catch (e) {
      return `Something went wrong: ${e.message}`;
    }
  }

  return { settings, save, handle, seerrSvc };
}

// ------------------------------------------------------------------ Telegram
export function createTelegramPoller({ core, apiBase = 'https://api.telegram.org', fetchImpl = globalThis.fetch, timeoutSec = 25, onError = () => {} }) {
  let running = false; let offset = 0; let controller = null; let status = { state: 'off', error: '', username: '' };
  const call = async (token, method, body, signal) => {
    const r = await fetchImpl(`${apiBase}/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), signal });
    const d = await r.json().catch(() => ({}));
    // Never include the URL (it holds the token) in errors.
    if (!d.ok) { const e = new Error(d.description || `HTTP ${r.status}`); e.code = d.error_code || r.status; throw e; }
    return d.result;
  };
  async function loop() {
    while (running) {
      const tg = core.settings().telegram;
      if (!tg.enabled || !tg.botToken) { status = { state: 'off', error: '', username: '' }; running = false; break; }
      controller = new AbortController();
      try {
        if (!status.username) { const me = await call(tg.botToken, 'getMe', {}, controller.signal); status = { state: 'polling', error: '', username: me.username || '' }; }
        const updates = await call(tg.botToken, 'getUpdates', { offset, timeout: timeoutSec, allowed_updates: ['message'] }, controller.signal);
        status.state = 'polling'; status.error = '';
        for (const u of updates || []) {
          offset = Math.max(offset, u.update_id + 1);
          const m = u.message;
          if (!m || !m.text || !m.chat) continue;
          const reply = await core.handle({ platform: 'telegram', id: m.chat.id, name: m.from ? [m.from.first_name, m.from.last_name].filter(Boolean).join(' ') || m.from.username : m.chat.title, text: m.text });
          if (reply) await call(tg.botToken, 'sendMessage', { chat_id: m.chat.id, text: reply.slice(0, 4000), reply_to_message_id: m.message_id, disable_web_page_preview: true }).catch((e) => onError(e));
        }
      } catch (e) {
        if (!running) break;
        status = { ...status, state: 'error', error: e.code === 401 ? 'Telegram rejected the bot token' : e.code === 409 ? 'Another program is reading this bot’s messages (only one can)' : e.name === 'AbortError' ? 'Stopped' : (e.message || 'Could not reach Telegram') };
        onError(e);
        await new Promise((r) => setTimeout(r, e.code === 401 ? 60000 : 10000));
      }
    }
  }
  return {
    start() { if (running) return; const tg = core.settings().telegram; if (!tg.enabled || !tg.botToken) return; running = true; status.username = ''; loop(); },
    stop() { running = false; if (controller) controller.abort(); status = { state: 'off', error: '', username: '' }; },
    restart() { this.stop(); setTimeout(() => this.start(), 50); },
    status: () => ({ ...status }),
    running: () => running,
  };
}

// ------------------------------------------------------------------- Discord
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
export function verifyDiscord(publicKeyHex, signatureHex, timestamp, rawBody) {
  try {
    if (!/^[0-9a-f]{64}$/i.test(publicKeyHex || '') || !/^[0-9a-f]{128}$/i.test(signatureHex || '')) return false;
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]), format: 'der', type: 'spki' });
    return edVerify(null, Buffer.concat([Buffer.from(String(timestamp)), Buffer.from(rawBody)]), key, Buffer.from(signatureHex, 'hex'));
  } catch { return false; }
}

export const DISCORD_COMMANDS = [
  { name: 'search', description: 'Look up a movie or show', options: [{ type: 3, name: 'title', description: 'Title', required: true }] },
  { name: 'request', description: 'Request a movie or show', options: [{ type: 3, name: 'title', description: 'Title, or a number from your last search', required: true }] },
  { name: 'status', description: 'Your recent requests' },
];

export function createDiscordHandler({ core, apiBase = 'https://discord.com/api/v10', fetchImpl = globalThis.fetch }) {
  // Express handler; needs the raw body (express.raw) for the signature.
  async function interactions(req, res) {
    const dc = core.settings().discord;
    if (!dc.enabled || !dc.publicKey) return res.status(404).json({ error: 'Discord requests are off' });
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (!verifyDiscord(dc.publicKey, req.get('x-signature-ed25519'), req.get('x-signature-timestamp'), raw)) return res.status(401).send('invalid request signature');
    let it; try { it = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).send('bad json'); }
    if (it.type === 1) return res.json({ type: 1 }); // PING
    if (it.type !== 2 || !it.data) return res.json({ type: 4, data: { content: 'Unsupported interaction', flags: 64 } });
    const u = (it.member && it.member.user) || it.user || {};
    const arg = ((it.data.options || [])[0] || {}).value || '';
    // Seerr can take longer than Discord's 3 seconds: defer, then edit.
    res.json({ type: 5, data: { flags: 64 } });
    const reply = await core.handle({ platform: 'discord', id: u.id, name: u.global_name || u.username, text: `/${it.data.name} ${arg}`.trim() });
    await fetchImpl(`${apiBase}/webhooks/${encodeURIComponent(dc.appId || it.application_id)}/${encodeURIComponent(it.token)}/messages/@original`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: String(reply || 'Done').slice(0, 1900) }) }).catch(() => {});
  }
  async function registerCommands() {
    const dc = core.settings().discord;
    if (!dc.appId || !dc.botToken) throw new Error('Application ID and bot token are needed to register commands');
    const r = await fetchImpl(`${apiBase}/applications/${encodeURIComponent(dc.appId)}/commands`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bot ${dc.botToken}` }, body: JSON.stringify(DISCORD_COMMANDS) });
    if (!r.ok) throw new Error(r.status === 401 ? 'Discord rejected the bot token' : `Discord said HTTP ${r.status}`);
    return (await r.json().catch(() => [])).length || DISCORD_COMMANDS.length;
  }
  return { interactions, registerCommands };
}

// ------------------------------------------------------------ admin settings
export function publicBot(s, status = {}) {
  const mask = (v) => (v ? MASK : '');
  return {
    telegram: { enabled: s.telegram.enabled, botToken: mask(s.telegram.botToken), status: status.telegram || null },
    discord: { enabled: s.discord.enabled, appId: s.discord.appId, publicKey: s.discord.publicKey, botToken: mask(s.discord.botToken) },
    seerrKey: s.seerrKey, users: s.users, pending: s.pending,
  };
}

export function applyBotSettings(s, input) {
  const out = { ...s, telegram: { ...s.telegram }, discord: { ...s.discord } };
  const keep = (v, prev) => (v === MASK ? prev : String(v || '').trim());
  if (input.telegram) {
    if (typeof input.telegram.enabled === 'boolean') out.telegram.enabled = input.telegram.enabled;
    if (input.telegram.botToken !== undefined) out.telegram.botToken = keep(input.telegram.botToken, s.telegram.botToken);
    if (out.telegram.botToken && !/^\d{5,}:[\w-]{20,}$/.test(out.telegram.botToken)) return { error: 'Telegram bot token looks wrong (from @BotFather)' };
    if (out.telegram.enabled && !out.telegram.botToken) return { error: 'Add the Telegram bot token first' };
  }
  if (input.discord) {
    const d = input.discord;
    if (typeof d.enabled === 'boolean') out.discord.enabled = d.enabled;
    if (d.appId !== undefined) out.discord.appId = String(d.appId || '').trim();
    if (d.publicKey !== undefined) out.discord.publicKey = String(d.publicKey || '').trim().toLowerCase();
    if (d.botToken !== undefined) out.discord.botToken = keep(d.botToken, s.discord.botToken);
    if (out.discord.appId && !/^\d{15,22}$/.test(out.discord.appId)) return { error: 'Discord application ID is a long number' };
    if (out.discord.publicKey && !/^[0-9a-f]{64}$/.test(out.discord.publicKey)) return { error: 'Discord public key is 64 hex characters (General Information page)' };
    if (out.discord.enabled && !out.discord.publicKey) return { error: 'Add the Discord public key first' };
  }
  if (input.seerrKey !== undefined) out.seerrKey = String(input.seerrKey || '');
  return { settings: out };
}

export function upsertBotUser(s, input) {
  const platform = input.platform === 'discord' ? 'discord' : input.platform === 'telegram' ? 'telegram' : null;
  const id = String(input.id || '').trim();
  if (!platform || !/^-?\d{1,22}$/.test(id)) return { error: 'Need a platform and a numeric id' };
  if (!['guest', 'user', 'admin'].includes(input.role)) return { error: 'Role must be guest, user or admin' };
  const u = { platform, id, name: String(input.name || '').slice(0, 60), role: input.role, seerrUserId: input.seerrUserId ? Number(input.seerrUserId) || null : null };
  return { settings: { ...s, users: [...s.users.filter((x) => !(x.platform === platform && x.id === id)), u], pending: s.pending.filter((p) => !(p.platform === platform && p.id === id)) } };
}
