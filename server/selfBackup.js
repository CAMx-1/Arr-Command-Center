// Back up Arr Command Center itself. One file holds the services (with
// their API keys) and the settings kept in the data folder: users and
// roles, two-factor and passkeys, notification channels and push devices,
// automation, links, everyone's saved settings, and the history behind the
// forecasts. The whole file is encrypted with a passphrase (PBKDF2-SHA256
// key, AES-256-GCM); without the passphrase it can't be opened.
//
// Restoring shows what's in the file first, then puts back the parts you
// pick. Services in the file are added or replaced and other services stay.
// History is joined day by day with what's here (this server's reading wins
// for a day both have). Each other part replaces what's here. Before
// anything changes, what's there is saved as another backup with the same
// passphrase.
//
// Not included: config.json's sign-in settings, port and disks; who's
// signed in; the Plex token kept from the last sign-in (it comes back at the
// next one); uptime and other short-lived state.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import express from 'express';
import { buildServiceUpdate, OVERLAY_PATH } from './config.js';
import { normalizeChannel } from './channels.js';
import { normalizeSettings as normalizeDigest } from './digest.js';
import { normalizeConfig as normalizeAutomation } from './automation.js';
import { CATEGORIES as PUSH_CATEGORIES, endpointAllowed } from './push.js';
import { mergePrefs } from './userPrefs.js';
import { ROLES, createRoleDirectory } from './roles.js';
import { ACTIVITY_CAP } from './activity.js';

export const FORMAT = 'arrcc-server-backup';
const LOCAL_FORMAT = 'arrcc-encrypted-backup'; // the iPhone app's own (local mode) backup
const VERSION = 1;
export const ITERATIONS = 600000;
const ITER_MIN = 100000;
const ITER_MAX = 5000000;
export const MIN_PASSPHRASE = 10;
const MAX_DATA = 40 * 1024 * 1024; // base64 characters in a file
const MAX_PLAIN = 80 * 1024 * 1024; // after unzipping
const KEEP_COPIES = 5;
const META_NS = 'selfBackup';
const COPY_RE = /^before-restore-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}\.arrccbackup$/;
const pbkdf2 = promisify(crypto.pbkdf2);
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export const PARTS = [
  { id: 'services', label: 'Services and their API keys' },
  { id: 'people', label: 'Users, roles and the services each role sees', ns: ['plexUsers', 'roleServices'] },
  { id: 'security', label: 'Two-factor sign-in, passkeys and sign-in alerts', ns: ['twoFactor', 'signInDevices'] },
  { id: 'notifications', label: 'Notification channels, push devices and categories, weekly digest, chat bot and incoming webhooks', ns: ['notifyChannels', 'pushPrefs', 'vapid', 'vapidSubject', 'pushSubscriptions', 'digest', 'bot', 'webhooks'] },
  { id: 'automation', label: 'Automation (queue cleaner and hunting)', ns: ['automation'] },
  { id: 'personal', label: 'Links, and the settings that follow each person', ns: ['links', 'userPrefs'] },
  { id: 'history', label: 'History: disk space and library growth, activity log and login log', ns: ['diskSnapshots', 'diskAlertState', 'librarySnapshots', 'activity', 'loginLog'], adds: true },
];
const PART = Object.fromEntries(PARTS.map((p) => [p.id, p]));
export const BACKED_UP = PARTS.flatMap((p) => p.ns || []);

const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const count = (v) => (Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : 0);
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// A plain JSON copy, without keys that look like prototype tricks.
export function plain(v, depth = 0) {
  if (depth > 16) throw new Error('nested too deeply');
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (Array.isArray(v)) return v.map((x) => plain(x, depth + 1));
  if (isObj(v)) {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (!BAD_KEYS.has(k) && x !== undefined) o[k] = plain(x, depth + 1);
    return o;
  }
  return null;
}
function objOf(v, ok = () => true, keyOk = () => true, map = plain) {
  const out = {};
  if (!isObj(v)) return out;
  for (const [k, x] of Object.entries(v)) {
    if (BAD_KEYS.has(k) || !keyOk(k) || !ok(x)) continue;
    try { out[k] = map(x); } catch { /* leave it out */ }
  }
  return out;
}

// ---- the file ----
const passKey = (p) => String(p ?? '').normalize('NFC');

export async function encryptBackup(payload, passphrase, { iterations = ITERATIONS } = {}) {
  const pass = passKey(passphrase);
  if (pass.length < MIN_PASSPHRASE) throw fail(400, `Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
  const salt = crypto.randomBytes(16); const iv = crypto.randomBytes(12);
  const key = await pbkdf2(pass, salt, iterations, 32, 'sha256');
  const zipped = await gzip(Buffer.from(JSON.stringify(payload), 'utf8'));
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  // Ciphertext then the 16-byte tag, as WebCrypto does it.
  const data = Buffer.concat([c.update(zipped), c.final(), c.getAuthTag()]);
  return {
    format: FORMAT, version: VERSION, createdAt: payload.createdAt, app: payload.app || '',
    kdf: { name: 'PBKDF2-SHA256', iterations, salt: salt.toString('base64') },
    cipher: { name: 'AES-256-GCM', iv: iv.toString('base64'), data: data.toString('base64') },
    compression: 'gzip',
  };
}

const notOurs = () => fail(400, 'That isn’t a backup of Arr Command Center.');
const damaged = () => fail(400, 'This backup file is damaged, or wasn’t made by Arr Command Center.');
export async function decryptBackup(envelope, passphrase) {
  if (!isObj(envelope)) throw notOurs();
  if (envelope.format === LOCAL_FORMAT) throw fail(400, 'That’s a backup of the iPhone app’s own connections (local mode). Import it in the app, in local mode: Settings → Services → Connection.');
  if (envelope.format !== FORMAT) throw notOurs();
  if (envelope.version !== VERSION) throw fail(400, 'This backup was made by a newer version of Arr Command Center. Update this server, then try again.');
  const kdf = isObj(envelope.kdf) ? envelope.kdf : {}; const cipher = isObj(envelope.cipher) ? envelope.cipher : {};
  const iterations = Number(kdf.iterations);
  if (kdf.name !== 'PBKDF2-SHA256' || cipher.name !== 'AES-256-GCM' || !Number.isInteger(iterations) || iterations < ITER_MIN || iterations > ITER_MAX) throw damaged();
  if (typeof cipher.data !== 'string') throw damaged();
  if (cipher.data.length > MAX_DATA) throw fail(413, 'This backup is too big to restore here.');
  const b64 = (v) => (typeof v === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(v) ? Buffer.from(v, 'base64') : null);
  const salt = b64(kdf.salt); const iv = b64(cipher.iv); const data = b64(cipher.data);
  if (!salt || salt.length !== 16 || !iv || iv.length !== 12 || !data || data.length < 17) throw damaged();
  const pass = passKey(passphrase);
  if (!pass) throw fail(400, 'Enter the backup’s passphrase.');
  const key = await pbkdf2(pass, salt, iterations, 32, 'sha256');
  let out;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(data.subarray(data.length - 16));
    out = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  } catch { throw fail(400, 'That passphrase didn’t open this backup.', { wrongPassphrase: true }); }
  try {
    if (envelope.compression === 'gzip') out = await gunzip(out, { maxOutputLength: MAX_PLAIN });
    return JSON.parse(out.toString('utf8'));
  } catch { throw damaged(); }
}

// ---- what goes in ----
export function collectBackup({ cfg, store, appVersion = '', now = Date.now() }) {
  const services = {};
  for (const [k, s] of Object.entries(cfg.services || {})) {
    if (!isObj(s)) continue;
    const o = {};
    for (const [f, v] of Object.entries(s)) if (!f.startsWith('_') && f !== 'key') o[f] = v;
    services[k] = plain(o);
  }
  const data = {};
  for (const ns of BACKED_UP) { const v = store.get(ns, undefined); if (v !== undefined && v !== null) data[ns] = plain(v); }
  return { kind: FORMAT, version: VERSION, createdAt: new Date(now).toISOString(), app: appVersion, services, data };
}

// ---- checking what comes back ----
const httpUrl = (u) => { try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch { return false; } };
const KEY_RE = /^[a-z0-9_-]{1,40}$/i;
const CLEAN = {
  plexUsers: (v) => (Array.isArray(v) ? v : []).filter((u) => isObj(u) && typeof u.id === 'string' && u.id.trim() && u.id.length <= 120 && ROLES.includes(u.role)).slice(0, 1000).map((u) => plain(u)),
  roleServices: (v) => Object.fromEntries(['user', 'guest'].map((r) => {
    const x = isObj(v) ? v[r] : null;
    return [r, Array.isArray(x) ? [...new Set(x.filter((k) => typeof k === 'string' && KEY_RE.test(k)))] : null];
  })),
  twoFactor: (v) => objOf(v, isObj, (k) => k.length <= 200),
  signInDevices: (v) => objOf(v, isObj, (k) => k.length <= 200),
  notifyChannels: (v, note) => (Array.isArray(v) ? v : []).filter(isObj).slice(0, 50).flatMap((c) => {
    const r = normalizeChannel(c, typeof c.id === 'string' && c.id ? c : null);
    if (r.error) { note(`Left out the channel “${String(c.name || c.type || '?').slice(0, 60)}”: ${r.error}`); return []; }
    return [r.channel];
  }),
  pushPrefs: (v) => Object.fromEntries(PUSH_CATEGORIES.filter((c) => isObj(v) && typeof v[c.id] === 'boolean').map((c) => [c.id, v[c.id]])),
  vapid: (v) => (isObj(v) && /^[A-Za-z0-9_-]{40,120}$/.test(v.publicKey || '') && /^[A-Za-z0-9_-]{20,80}$/.test(v.privateKey || '') ? { publicKey: v.publicKey, privateKey: v.privateKey } : undefined),
  vapidSubject: (v) => (typeof v === 'string' && v.length < 300 && /^(mailto:|https:\/\/)/.test(v) ? v : undefined),
  pushSubscriptions: (v) => (Array.isArray(v) ? v : []).filter((s) => isObj(s) && typeof s.endpoint === 'string' && endpointAllowed(s.endpoint) && isObj(s.keys) && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string').slice(0, 1000).map((s) => plain(s)),
  digest: (v) => {
    if (!isObj(v)) return undefined;
    const r = normalizeDigest(v);
    if (r.error) throw new Error(r.error);
    return { ...r.settings, lastSent: typeof v.lastSent === 'string' ? v.lastSent : null };
  },
  bot: (v) => (isObj(v) ? plain(v) : undefined),
  webhooks: (v) => objOf(v, (r) => isObj(r) && typeof r.token === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(r.token), (k) => KEY_RE.test(k)),
  automation: (v) => (isObj(v) ? normalizeAutomation(v) : undefined),
  links: (v, note) => (Array.isArray(v) ? v : []).filter(isObj).slice(0, 500).flatMap((l) => {
    if (!l.label || !httpUrl(l.url)) { note(`Left out the link “${String(l.label || l.url || '?').slice(0, 60)}”: it needs a name and an http(s) address.`); return []; }
    const icon = typeof l.icon === 'string' && (httpUrl(l.icon) || l.icon.startsWith('/')) ? l.icon.slice(0, 300) : '';
    return [{ id: typeof l.id === 'string' && l.id ? l.id.slice(0, 64) : crypto.randomUUID(), label: String(l.label).slice(0, 60), url: String(l.url).slice(0, 500), icon, category: typeof l.category === 'string' ? l.category.slice(0, 40) : '', embed: !!l.embed }];
  }),
  userPrefs: (v) => objOf(v, (r) => isObj(r) && isObj(r.prefs), (k) => k.length <= 200, (r) => ({ rev: Number(r.rev) || 1, at: Number(r.at) || null, prefs: mergePrefs({}, r.prefs).prefs })),
  diskSnapshots: (v) => objOf(v, isObj),
  diskAlertState: (v) => objOf(v),
  librarySnapshots: (v) => objOf(v),
  activity: (v) => (Array.isArray(v) ? v.filter(isObj).slice(0, ACTIVITY_CAP).map((x) => plain(x)) : []),
  loginLog: (v) => (Array.isArray(v) ? v.filter(isObj).slice(0, 200).map((x) => plain(x)) : []),
};
const NS_LABEL = { notifyChannels: 'notification channels', userPrefs: 'saved settings', digest: 'the weekly digest', twoFactor: 'two-factor', plexUsers: 'users' };

// Check and tidy a decrypted backup: { createdAt, app, services, data, notes }.
export function readPayload(payload) {
  if (!isObj(payload) || payload.kind !== FORMAT || payload.version !== VERSION) throw damaged();
  const notes = [];
  const services = {};
  for (const [key, svc] of Object.entries(isObj(payload.services) ? payload.services : {})) {
    if (!KEY_RE.test(key) || !isObj(svc)) { notes.push(`Left out a service with the name “${key.slice(0, 40)}”.`); continue; }
    services[key] = plain(svc);
  }
  const data = {};
  const src = isObj(payload.data) ? payload.data : {};
  for (const ns of BACKED_UP) {
    if (!Object.prototype.hasOwnProperty.call(src, ns) || src[ns] == null) continue;
    try { const v = CLEAN[ns](src[ns], (m) => notes.push(m)); if (v !== undefined) data[ns] = v; }
    catch (e) { notes.push(`Left out ${NS_LABEL[ns] || ns}: ${e.message}`); }
  }
  return { createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : null, app: typeof payload.app === 'string' ? payload.app.slice(0, 40) : '', services, data, notes };
}

// A line about what a part holds, for the backup and for this server.
export function summary(id, services, d) {
  switch (id) {
    case 'services': return plural(count(services), 'service');
    case 'people': {
      const rs = isObj(d.roleServices) ? d.roleServices : {};
      const limited = ['user', 'guest'].filter((r) => Array.isArray(rs[r]));
      return [plural(count(d.plexUsers), 'user'), limited.length ? `fewer services for ${limited.map((r) => `${r}s`).join(' and ')}` : null].filter(Boolean).join(', ');
    }
    case 'security': {
      const recs = Object.values(isObj(d.twoFactor) ? d.twoFactor : {}).filter(isObj);
      const on = recs.filter((r) => r.secret || (Array.isArray(r.passkeys) && r.passkeys.length)).length;
      const keys = recs.reduce((n, r) => n + (Array.isArray(r.passkeys) ? r.passkeys.length : 0), 0);
      return `${plural(on, 'person', 'people')} with two-factor${keys ? `, ${plural(keys, 'passkey')}` : ''}`;
    }
    case 'notifications': {
      const bot = isObj(d.bot) ? d.bot : {};
      const bits = [plural(count(d.notifyChannels), 'channel'), plural(count(d.pushSubscriptions), 'push device')];
      if (isObj(d.digest) && d.digest.enabled) bits.push('weekly digest on');
      const bots = [isObj(bot.telegram) && bot.telegram.enabled ? 'Telegram' : null, isObj(bot.discord) && bot.discord.enabled ? 'Discord' : null].filter(Boolean);
      if (bots.length) bits.push(`chat bot on ${bots.join(' and ')}`);
      if (count(d.webhooks)) bits.push(plural(count(d.webhooks), 'incoming webhook'));
      return bits.join(', ');
    }
    case 'automation': {
      if (!isObj(d.automation)) return 'the default settings';
      const a = d.automation;
      return `queue cleaner ${isObj(a.queueCleaner) && a.queueCleaner.enabled ? 'on' : 'off'}, hunting ${isObj(a.hunting) && a.hunting.enabled ? 'on' : 'off'}`;
    }
    case 'personal': return `${plural(count(d.links), 'link')}, saved settings for ${plural(count(d.userPrefs), 'person', 'people')}`;
    case 'history': {
      const days = Math.max(0, ...Object.values(isObj(d.diskSnapshots) ? d.diskSnapshots : {}).map((s) => (isObj(s) && Array.isArray(s.history) ? s.history.length : 0)));
      return `${plural(days, 'day')} of disk readings, ${plural(count(d.activity), 'activity entry', 'activity entries')}, ${plural(count(d.loginLog), 'sign-in')}`;
    }
    default: return '';
  }
}

// History is joined with what's here rather than replacing it, so restoring
// an older backup never loses newer readings.
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
function joinDays(backup, here, keep) {
  const m = new Map();
  for (const list of [backup, here]) for (const x of Array.isArray(list) ? list : []) if (isObj(x) && typeof x.date === 'string') m.set(x.date, x);
  return [...m.values()].sort(byDate).slice(-keep);
}
function joinLog(backup, here, keyOf, timeOf, cap) {
  const m = new Map();
  for (const e of [...(Array.isArray(here) ? here : []), ...(Array.isArray(backup) ? backup : [])]) if (isObj(e) && !m.has(keyOf(e))) m.set(keyOf(e), e);
  return [...m.values()].sort((a, b) => timeOf(b) - timeOf(a)).slice(0, cap); // newest first, as they're kept
}
const JOIN = {
  librarySnapshots: (b, h) => { const out = { ...(isObj(h) ? h : {}) }; for (const [k, list] of Object.entries(b)) out[k] = joinDays(list, out[k], 730); return out; },
  diskSnapshots: (b, h) => {
    const out = { ...(isObj(h) ? h : {}) };
    for (const [k, rec] of Object.entries(b)) { const cur = out[k]; out[k] = isObj(cur) ? { ...rec, ...cur, history: joinDays(rec.history, cur.history, 400) } : rec; }
    return out;
  },
  diskAlertState: (b, h) => ({ ...b, ...(isObj(h) ? h : {}) }),
  activity: (b, h) => joinLog(b, h, (e) => `${e.at}|${e.user}|${e.method}|${e.action}`, (e) => Date.parse(e.at) || 0, ACTIVITY_CAP),
  loginLog: (b, h) => joinLog(b, h, (e) => `${e.at}|${e.user}|${e.ip}`, (e) => Number(e.at) || 0, 200),
};
// What a namespace holds after restoring (undefined: removed).
function nextValue(ns, read, here) {
  const b = read.data[ns];
  if (JOIN[ns]) return b === undefined ? here[ns] : JOIN[ns](b, here[ns]);
  return b;
}

const FIELD_NAMES = { label: 'name', type: 'type', enabled: 'on or off', baseUrl: 'address', apiKey: 'API key', username: 'username', password: 'password', cloudflareAccess: 'Cloudflare Access', customHeaders: 'custom headers', webUrl: 'browser address', rpcPath: 'RPC path' };
const stable = (v) => JSON.stringify(v, (k, x) => (isObj(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
const hostOf = (u) => { try { return new URL(u).host; } catch { return ''; } };

// Which services restoring would add, change, leave alone or skip.
export function planServices(backup, current) {
  const out = { add: [], change: [], same: [], keep: [], skip: [] };
  const cleaned = {};
  for (const [key, svc] of Object.entries(backup)) {
    const built = buildServiceUpdate(key, svc, {});
    if (built.error) { out.skip.push({ key, label: String(svc.label || key).slice(0, 60), reason: built.error }); continue; }
    cleaned[key] = built.clean;
    const row = { key, label: built.clean.label, type: built.clean.type, host: hostOf(built.clean.baseUrl) };
    const cur = current[key];
    if (!cur) { out.add.push(row); continue; }
    const now = buildServiceUpdate(key, cur, {}).clean || cur;
    const fields = Object.keys(FIELD_NAMES).filter((f) => stable(now[f] ?? null) !== stable(built.clean[f] ?? null));
    if (fields.length) out.change.push({ ...row, changes: fields.map((f) => FIELD_NAMES[f]) }); else out.same.push(row);
  }
  for (const [key, svc] of Object.entries(current)) if (!(key in backup)) out.keep.push({ key, label: (svc && svc.label) || key, type: svc && svc.type, host: hostOf(svc && svc.baseUrl) });
  return { ...out, cleaned };
}

const verParts = (v) => String(v).split(/[.-]/).slice(0, 3).map((x) => Number(x) || 0);
const newer = (a, b) => { const x = verParts(a); const y = verParts(b); for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
const tfOn = (r) => isObj(r) && !!(r.secret || (Array.isArray(r.passkeys) && r.passkeys.length));

// What restoring would do. viewer: { plexAuth, user, email, host } for the
// admin doing it.
export function planRestore(read, { cfg, store, viewer = null, mock = false, servicesWritable = true, appVersion = '' }) {
  const here = Object.fromEntries(BACKED_UP.map((ns) => [ns, store.get(ns, undefined)]));
  const services = planServices(read.services, cfg.services || {});
  const notes = [...read.notes];
  if (read.app && appVersion && newer(read.app, appVersion)) notes.push(`Made with a newer version (${read.app}) than this server (${appVersion}). Anything this version doesn’t know about is left out.`);
  const parts = PARTS.map((p) => {
    const part = { id: p.id, label: p.label, adds: p.id === 'services' || !!p.adds, backup: summary(p.id, read.services, read.data), here: summary(p.id, cfg.services || {}, here), empty: false, same: false, blocked: null, warnings: [] };
    if (p.id === 'services') {
      part.empty = !Object.keys(read.services).length;
      part.same = !part.empty && !services.add.length && !services.change.length;
      if (mock) part.blocked = 'Services can’t be changed in demo mode.';
      else if (!servicesWritable) part.blocked = 'Neither config.json nor the data folder can be written, so services can’t be saved.';
      if (services.keep.length) part.warnings.push(`${plural(services.keep.length, 'service')} here ${services.keep.length === 1 ? 'isn’t' : 'aren’t'} in the backup and will stay.`);
      return part;
    }
    part.empty = !p.ns.some((ns) => ns in read.data);
    part.same = !part.empty && p.ns.every((ns) => stable(nextValue(ns, read, here) ?? null) === stable(here[ns] ?? null));
    if (viewer && viewer.plexAuth && viewer.user) {
      if (p.id === 'people') {
        const dir = createRoleDirectory(cfg, { get: (ns, def) => (ns === 'plexUsers' ? (read.data.plexUsers || []) : store.get(ns, def)) });
        if (dir.lookup(viewer.user, viewer.email) !== 'admin') part.blocked = `You (${viewer.user}) aren’t an admin in this backup’s users, so restoring them would take away your admin access.`;
      }
      if (p.id === 'security') {
        const k = String(viewer.user).toLowerCase();
        const b = (read.data.twoFactor || {})[k]; const h = (here.twoFactor || {})[k];
        if (tfOn(b) && !tfOn(h)) part.warnings.push('This turns two-factor on for you, with the authenticator app and passkeys you had when the backup was made. Have a recovery code from then ready.');
        else if (!tfOn(b) && tfOn(h)) part.warnings.push('This turns two-factor off for you: it was off when the backup was made.');
        else if (tfOn(b) && tfOn(h) && b.secret !== h.secret) part.warnings.push('This puts back the authenticator app code from when the backup was made.');
        const rpIds = new Set(Object.values(read.data.twoFactor || {}).flatMap((r) => (isObj(r) && Array.isArray(r.passkeys) ? r.passkeys.map((x) => x && x.rpId) : [])).filter(Boolean));
        const host = String((viewer && viewer.host) || '').toLowerCase();
        const elsewhere = [...rpIds].filter((id) => host && host !== id && !host.endsWith(`.${id}`));
        if (elsewhere.length) part.warnings.push(`Passkeys only work on the address they were made on (${elsewhere.join(', ')}); this server is at ${host}.`);
      }
    }
    return part;
  });
  return { createdAt: read.createdAt, app: read.app, parts, services: { add: services.add, change: services.change, same: services.same, keep: services.keep, skip: services.skip }, notes, cleaned: services.cleaned };
}

// Bump each person's revision so browsers synced to the old copy merge again.
const bumpRevs = (incoming, current, now) => Object.fromEntries(Object.entries(incoming).map(([k, r]) => [k, { ...r, rev: Math.max(Number(r.rev) || 0, Number((isObj(current) && isObj(current[k]) && current[k].rev) || 0)) + 1, at: now }]));

// Put the chosen parts back. saveCopy(payload) keeps what's replaced.
export async function applyRestore(read, chosen, ctx) {
  const { cfg, store, serviceWriter, onServiceSaved = () => {}, after = () => {}, saveCopy = async () => null, now = Date.now() } = ctx;
  const plan = planRestore(read, ctx);
  const pick = new Set(chosen);
  const todo = plan.parts.filter((p) => pick.has(p.id) && !p.empty && !p.blocked);
  const refused = plan.parts.filter((p) => pick.has(p.id) && p.blocked).map((p) => ({ id: p.id, label: p.label, reason: p.blocked }));
  if (!todo.length) throw fail(400, refused.length ? refused[0].reason : 'Pick at least one part of the backup to restore.');
  // First, a backup of what's about to be replaced.
  const before = { kind: FORMAT, version: VERSION, createdAt: new Date(now).toISOString(), app: ctx.appVersion || '', services: {}, data: {} };
  for (const p of todo) {
    if (p.id === 'services') { for (const r of plan.services.change) before.services[r.key] = plain(cfg.services[r.key]); continue; }
    for (const ns of PART[p.id].ns) { const v = store.get(ns, undefined); if (v != null) before.data[ns] = plain(v); }
  }
  const copy = Object.keys(before.services).length || Object.keys(before.data).length ? await saveCopy(before) : null;
  const restored = [];
  for (const p of todo) {
    if (p.id === 'services') {
      const rows = [...plan.services.add, ...plan.services.change];
      for (const r of rows) {
        const clean = plan.cleaned[r.key];
        await serviceWriter.save(r.key, clean);
        cfg.services[r.key] = { ...clean };
        try { onServiceSaved(r.key); } catch { /* best effort */ }
      }
      const added = plan.services.add.length; const changed = plan.services.change.length;
      restored.push({ id: p.id, label: p.label, detail: added && changed ? `added ${plural(added, 'service')}, changed ${changed}` : added ? `added ${plural(added, 'service')}` : changed ? `changed ${plural(changed, 'service')}` : 'already the same' });
      continue;
    }
    const here = Object.fromEntries(PART[p.id].ns.map((ns) => [ns, store.get(ns, undefined)]));
    const values = {};
    for (const ns of PART[p.id].ns) {
      let v = nextValue(ns, read, here);
      if (v === undefined) {
        if (ns === 'vapid') { values[ns] = here[ns]; continue; } // never drop the push keys: every device would need to turn notifications on again
        store.set(ns, undefined);
        continue;
      }
      if (ns === 'userPrefs') v = bumpRevs(v, here[ns], now);
      store.set(ns, v); values[ns] = v;
    }
    restored.push({ id: p.id, label: p.label, detail: summary(p.id, {}, values) });
  }
  try { await after(todo.map((p) => p.id)); } catch { /* best effort */ }
  return { restored, refused, copy, notes: plan.notes };
}

// The /api/self-backup routes. Admin only (roles.js); making and restoring a
// backup ask "Confirm it's you" for accounts with two-factor.
export function createSelfBackup({ cfg, store, serviceWriter, stepUp = null, plexAuth = null, appVersion = '', copiesDir = path.join(path.dirname(OVERLAY_PATH), 'backups'), onServiceSaved, after, now = () => Date.now() }) {
  let chain = Promise.resolve();
  const one = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; }; // one key derivation at a time
  const meta = () => { const m = store.get(META_NS, null); return isObj(m) ? m : {}; };
  const who = (req) => req.plexUser || 'admin';
  const viewerOf = (req) => ({ plexAuth: !!(plexAuth && plexAuth.enabled), user: req.plexUser || null, email: req.plexEmail || null, host: req.hostname || '' });
  const servicesTarget = () => (cfg.mock ? 'demo' : serviceWriter.target());
  const ctxFor = (req) => ({ cfg, store, viewer: viewerOf(req), mock: !!cfg.mock, servicesWritable: !!serviceWriter.target(), appVersion, now: now() });
  const send = (res, e) => res.status(e.status || 500).json({ error: e.status ? e.message : `Something went wrong: ${e.message}`, ...(e.wrongPassphrase ? { wrongPassphrase: true } : {}) });
  const stamp = () => new Date(now()).toISOString().slice(0, 23).replace(/[:.]/g, '-');

  async function listCopies() {
    let names = [];
    try { names = (await fsp.readdir(copiesDir)).filter((n) => COPY_RE.test(n)); } catch { return []; }
    const out = [];
    for (const name of names) { try { const st = await fsp.stat(path.join(copiesDir, name)); out.push({ name, at: st.mtimeMs, size: st.size }); } catch { /* gone */ } }
    return out.sort((a, b) => b.name.localeCompare(a.name));
  }
  async function saveCopy(payload, passphrase) {
    const env = await encryptBackup(payload, passphrase);
    await fsp.mkdir(copiesDir, { recursive: true, mode: 0o700 });
    const name = `before-restore-${stamp()}.arrccbackup`;
    await fsp.writeFile(path.join(copiesDir, name), JSON.stringify(env), { mode: 0o600 });
    for (const old of (await listCopies()).slice(KEEP_COPIES)) await fsp.rm(path.join(copiesDir, old.name), { force: true });
    return name;
  }

  const router = express.Router();
  const small = express.json({ limit: '4kb' });
  const big = express.json({ limit: '45mb' });
  const confirm = (doing) => (stepUp ? stepUp.app(doing) : (req, res, next) => next());
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  router.get('/', async (req, res) => {
    const here = Object.fromEntries(BACKED_UP.map((ns) => [ns, store.get(ns, undefined)]));
    res.json({ parts: PARTS.map((p) => ({ id: p.id, label: p.label, here: summary(p.id, cfg.services || {}, here) })), minPassphrase: MIN_PASSPHRASE, last: meta(), copies: await listCopies(), servicesIn: servicesTarget() });
  });
  router.post('/export', small, confirm('making a backup'), async (req, res) => {
    try {
      const backup = await one(() => encryptBackup(collectBackup({ cfg, store, appVersion, now: now() }), req.body && req.body.passphrase));
      store.set(META_NS, { ...meta(), lastExport: { at: now(), by: who(req) } });
      res.json({ backup, fileName: `arr-command-center-backup-${new Date(now()).toISOString().slice(0, 10)}.arrccbackup` });
    } catch (e) { send(res, e); }
  });
  router.post('/preview', big, async (req, res) => {
    try {
      const read = readPayload(await one(() => decryptBackup(req.body && req.body.backup, req.body && req.body.passphrase)));
      const { cleaned, ...plan } = planRestore(read, ctxFor(req)); // eslint-disable-line no-unused-vars
      res.json(plan);
    } catch (e) { send(res, e); }
  });
  router.post('/restore', big, confirm('restoring a backup'), async (req, res) => {
    try {
      const pass = req.body && req.body.passphrase;
      const parts = Array.isArray(req.body && req.body.parts) ? req.body.parts.map(String) : [];
      const out = await one(async () => {
        const read = readPayload(await decryptBackup(req.body && req.body.backup, pass));
        return applyRestore(read, parts, { ...ctxFor(req), serviceWriter, onServiceSaved, after, saveCopy: (payload) => saveCopy(payload, pass) });
      });
      store.set(META_NS, { ...meta(), lastRestore: { at: now(), by: who(req), parts: out.restored.map((r) => r.id) } });
      res.json(out);
    } catch (e) { send(res, e); }
  });
  router.get('/copies/:name', (req, res) => {
    const name = String(req.params.name || '');
    if (!COPY_RE.test(name) || !fs.existsSync(path.join(copiesDir, name))) return res.status(404).json({ error: 'That copy isn’t there any more.' });
    res.download(path.join(copiesDir, name), name);
  });
  return { router, listCopies };
}
