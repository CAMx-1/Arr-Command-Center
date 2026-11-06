import { h, mount, clear, toast, empty, spinner, fmtBytes, fmtRelative, debounce, openModal, closeModal } from '../lib/ui.js';
import { dismissNativeKeyboard } from '../lib/nativeApp.js';
import { actionGroup } from '../lib/actions.js';
import { pushTargets, pushRelease, sendToSabnzbd } from '../lib/releasePush.js';
import { isLocalMode } from '../lib/connections.js';

// Usenet indexer search — LunaSea-style "Search" for public indexers such as
// NZBGeek (Indexer API Host + Indexer API Key). Public indexers expose the
// standard Newznab API (?apikey=, t=search, cat=...), so the same host/key/
// category mechanism works across them. Results can be grabbed straight to a
// configured SABnzbd instance. Filters for audiobooks, books, audio, PC and
// console releases.

// Category groups (standard indexer scheme). Sending cat=<group> (a *000 value)
// matches all of its subcategories; specific subcats are listed to be safe
// across indexers that don't expand groups.
const CATEGORIES = [
  { id: 'audiobooks', label: 'Audiobooks', cat: '3030' },
  // Books: Magazines, eBook, Comics, Technical, Other, Foreign.
  { id: 'books', label: 'Books', cat: '7000,7010,7020,7030,7040,7050,7060' },
  { id: 'audio', label: 'Audio', cat: '3000,3010,3020,3040' },
  // PC: 0-day, ISO, Mac, Mobile (other), Games, iOS, Android.
  { id: 'pc', label: 'PC', cat: '4000,4010,4020,4030,4040,4050,4060,4070' },
  // Console: NDS, PSP, Wii, Xbox, Xbox 360, WiiWare, Xbox 360 DLC, PS3, Other,
  // 3DS, PS Vita, Wii U, Xbox One, PS4.
  { id: 'console', label: 'Console', cat: '1000,1010,1020,1030,1040,1050,1060,1070,1080,1090,1110,1120,1130,1140,1180' },
  { id: 'all', label: 'All', cat: '' },
];

// Names of the standard subcategories, shown on each result.
const SUBCATS = {
  1010: 'NDS', 1020: 'PSP', 1030: 'Wii', 1040: 'Xbox', 1050: 'Xbox 360', 1060: 'WiiWare', 1070: 'Xbox 360 DLC',
  1080: 'PS3', 1090: 'Console', 1110: '3DS', 1120: 'PS Vita', 1130: 'Wii U', 1140: 'Xbox One', 1180: 'PS4',
  4010: '0-day', 4020: 'PC ISO', 4030: 'Mac', 4040: 'Mobile', 4050: 'PC Games', 4060: 'iOS', 4070: 'Android',
  7040: 'Technical', 7050: 'Books', 7060: 'Foreign books',
};

function catLabel(c) {
  const n = Number(c);
  if (SUBCATS[n]) return SUBCATS[n];
  if (n >= 1000 && n < 2000) return 'Console';
  if (n >= 4000 && n < 5000) return 'PC';
  if (n === 3030) return 'Audiobook';
  if (n >= 7030 && n < 7040) return 'Comics';
  if (n >= 7020 && n < 7030) return 'eBook';
  if (n >= 7010 && n < 7020) return 'Magazine';
  if (n >= 7000 && n < 8000) return 'Books';
  if (n >= 3000 && n < 4000) return 'Audio';
  return c ? String(c) : '—';
}
function catIcon(c) {
  const n = Number(c);
  if (n >= 1000 && n < 2000) return '🎮';
  if (n >= 4000 && n < 5000) return '💻';
  if (n === 3030) return '🎧';
  if (n >= 7030 && n < 7040) return '📖';
  if (n >= 7000 && n < 8000) return '📚';
  if (n >= 3000 && n < 4000) return '🎵';
  return '📄';
}

// Tolerant parser for indexer search JSON (channel.item may be object or array,
// and the grab URL / size / category / grabs live in enclosure or attrs).
function attrOf(item, name) {
  const a = item.attr || item['newznab:attr'] || [];
  const arr = Array.isArray(a) ? a : [a];
  for (const x of arr) { const at = (x && x['@attributes']) || x || {}; if (at.name === name) return at.value; }
  return undefined;
}
// Extract a URL from a Newznab field that may be a string or an object
// ({text}/{_}/{@attributes:{url|href|isPermaLink}}).
function urlOf(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return v.text || v._ || (v['@attributes'] && (v['@attributes'].url || v['@attributes'].href)) || '';
  return '';
}
// Pull a query param (first match) out of a URL string.
function paramFromUrl(u, names) {
  try { const q = new URL(u).searchParams; for (const n of names) { const v = q.get(n); if (v) return v; } } catch { /* not a URL */ }
  return '';
}
function normalize(item) {
  const enc = item.enclosure && (item.enclosure['@attributes'] || item.enclosure);
  const url = (enc && enc.url) || item.link || '';
  const size = Number(attrOf(item, 'size') || (enc && enc.length) || item.size || 0);
  let cat = attrOf(item, 'category');
  if (cat == null) cat = Array.isArray(item.category) ? item.category[0] : item.category;

  // Comments page + details/permalink page on the indexer.
  const comments = urlOf(item.comments);
  const guidStr = urlOf(item.guid);
  let details = /^https?:\/\//i.test(guidStr) ? guidStr : '';
  if (!details && comments) details = comments.replace(/#.*$/, '');
  const description = typeof item.description === 'string' ? item.description.trim() : '';

  // Release GUID used for the Newznab comments/details API (t=comments&guid=…).
  // Prefer the explicit attr, else pull ?id=/?guid= from the nzb or permalink URL.
  let id = attrOf(item, 'guid') || '';
  if (!id) id = paramFromUrl(url, ['id', 'guid']);
  if (!id && guidStr) id = paramFromUrl(guidStr, ['guid', 'id']) || (/^https?:\/\//i.test(guidStr) ? '' : guidStr);

  return {
    title: item.title || 'Untitled',
    url,
    size,
    cat: cat != null ? String(cat) : '',
    grabs: Number(attrOf(item, 'grabs') || 0),
    pubDate: item.pubDate || item.pubdate || null,
    id,
    comments,
    details,
    description,
    commentsCount: Number(attrOf(item, 'comments') || 0),
    poster: attrOf(item, 'poster') || '',
    group: attrOf(item, 'group') || '',
    files: Number(attrOf(item, 'files') || 0),
  };
}

export function parseItems(data) {
  const ch = data && data.channel;
  let items = ch && ch.item;
  if (!items) return [];
  if (!Array.isArray(items)) items = [items];
  return items.map(normalize);
}

export function renderIndexer(root, ctx) {
  const svc = ctx.service;
  ctx.setActions();
  if (!svc.configured) return mount(root, notConfigured(svc));

  let activeCat = 'audiobooks';
  const input = h('input', { class: 'input', type: 'search', placeholder: 'Search the indexer… (leave blank to browse latest)', style: { flex: '1', minWidth: '200px' } });
  const results = h('div', {});

  const segBtn = (c) => h('button', {
    class: `btn sm ${activeCat === c.id ? 'primary' : ''}`,
    onclick: () => { if (activeCat === c.id) return; activeCat = c.id; renderSegs(); doSearch(); },
  }, c.label);
  const segWrap = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' } });
  const renderSegs = () => { clear(segWrap); CATEGORIES.forEach((c) => segWrap.appendChild(segBtn(c))); };

  const doSearch = async () => {
    const cat = (CATEGORIES.find((c) => c.id === activeCat) || {}).cat || '';
    const q = input.value.trim();
    mount(results, h('div', { style: { padding: '24px' } }, spinner()));
    try {
      const data = await ctx.api.indexer(svc.key, { t: 'search', q, cat, extended: '1', limit: '100' });
      const items = parseItems(data);
      if (!items.length) {
        mount(results, empty('🔍', q ? 'No results' : 'Nothing here', q ? `No matches for “${q}” in this category` : 'This category has no recent releases'));
        return;
      }
      items.sort((a, b) => b.grabs - a.grabs);
      mount(results, h('div', { class: 'section-title' }, `${items.length} result${items.length === 1 ? '' : 's'}`), h('div', { class: 'list' }, ...items.map((it) => resultRow(it, ctx))));
    } catch (err) {
      mount(results, empty('⚠️', 'Search failed', err.message, { label: 'Retry', onClick: doSearch }));
    }
  };
  const debounced = debounce(doSearch, 400);
  input.addEventListener('input', debounced);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { doSearch(); void dismissNativeKeyboard(input); } });

  renderSegs();
  mount(root,
    h('div', { style: { display: 'flex', gap: '8px', marginBottom: '10px' } }, input, h('button', { class: 'btn primary', onclick: doSearch }, 'Search')),
    segWrap,
    results,
  );
  doSearch();
}

function resultRow(it, ctx) {
  return h('div', { class: 'row' },
    h('div', { class: 'poster', style: { width: '40px', height: '40px', fontSize: '18px' } }, catIcon(it.cat)),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, it.title),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: 'pill muted' }, catLabel(it.cat)),
        h('span', {}, fmtBytes(it.size)),
        h('span', {}, `${it.grabs} grab${it.grabs === 1 ? '' : 's'}`),
        it.pubDate ? h('span', {}, fmtRelative(it.pubDate)) : null,
      ),
    ),
    actionGroup([
      (it.comments || it.details) ? { label: `\uD83D\uDCAC${it.commentsCount ? ` ${it.commentsCount}` : ''}`, title: 'Read comments on the indexer', onClick: () => openLink(it.comments || it.details) } : null,
      { label: 'Details', title: 'View details', onClick: () => openDetailsModal(it, ctx) },
      ...appActions(ctx, it),
      { label: '+ Send to SAB', title: 'Send to SABnzbd', variant: 'primary', primary: true, disabled: !it.url, onClick: () => sendToSab(ctx, it) },
    ], { sheetTitle: it.title }),
  );
}

// Open an external indexer URL safely in a new tab.
function openLink(url) {
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
}

function detailRow(label, value) {
  return h('div', { class: 'setting-row' }, h('span', { class: 'dim' }, label), h('span', { class: 'right' }, value));
}

// Details modal: full metadata for a result. Comments are read on the indexer's
// own site (its API doesn't reliably scope comments to a single release), so we
// link out to the release page rather than showing them inline.
function openDetailsModal(it, ctx) {
  const body = h('div', {},
    detailRow('Category', catLabel(it.cat)),
    detailRow('Size', fmtBytes(it.size)),
    it.pubDate ? detailRow('Age', fmtRelative(it.pubDate)) : null,
    detailRow('Grabs', String(it.grabs)),
    it.commentsCount ? detailRow('Comments', String(it.commentsCount)) : null,
    it.files ? detailRow('Files', String(it.files)) : null,
    it.group ? detailRow('Group', it.group) : null,
    it.poster ? detailRow('Poster', it.poster) : null,
    it.description ? h('p', { class: 'dim', style: { margin: '14px 0 0', lineHeight: '1.6' } }, it.description) : null,
  );
  const footer = h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end', width: '100%' } },
    (it.comments || it.details) ? h('button', { class: 'btn hex-btn', title: 'Read comments on the indexer', onclick: () => openLink(it.comments || it.details) }, `💬 Comments${it.commentsCount ? ` (${it.commentsCount})` : ''}`) : null,
    it.details ? h('button', { class: 'btn hex-btn', title: 'Open the release page on the indexer', onclick: () => openLink(it.details) }, '↗ View on indexer') : null,
    ...pushTargets(ctx.state.services, it.cat).map((svc) => h('button', { class: 'btn hex-btn', disabled: it.url ? null : 'disabled', title: `Let ${svc.label} grab and track it`, 'data-needs': 'write', onclick: () => { closeModal(); sendToApp(ctx, it, svc); } }, `+ ${svc.label}`)),
    h('button', { class: 'btn primary hex-btn', disabled: it.url ? null : 'disabled', onclick: () => { closeModal(); sendToSab(ctx, it); } }, '+ Send to SAB'),
  );
  openModal({ title: it.title, body, footer, wide: true });
}

// "+ Sonarr" / "+ Radarr" / …: one button per matching app instance.
function appActions(ctx, it) {
  return pushTargets(ctx.state.services, it.cat).map((svc) => ({ label: `+ ${svc.label}`, title: `Let ${svc.label} grab and track it (imports like its own grabs)`, needs: 'write', disabled: !it.url, onClick: () => sendToApp(ctx, it, svc) }));
}
async function sendToApp(ctx, it, svc) {
  try {
    const r = await pushRelease(ctx.api, svc, it, { indexerKey: ctx.service.key, indexerName: ctx.service && ctx.service.label, local: isLocalMode() });
    toast(r.text, r.ok ? 'success' : 'warn', r.ok ? 3500 : 8000);
  } catch (e) { toast(`${svc.label}: ${e.message}`, 'error'); }
}

function sabInstances(ctx) {
  return (ctx.state.services || []).filter((s) => s.type === 'sabnzbd' && s.configured);
}

async function sendToSab(ctx, it) {
  const sabs = sabInstances(ctx);
  if (!sabs.length) { toast('No SABnzbd service is configured', 'error'); return; }
  const send = async (svc) => {
    try {
      await sendToSabnzbd(ctx.api, svc, it, { indexerKey: ctx.service.key, local: isLocalMode() });
      toast(`Sent to ${svc.label}`, 'success');
    } catch (e) { toast(e.message, 'error'); }
  };
  if (sabs.length === 1) return send(sabs[0]);
  openModal({
    title: 'Send to which SABnzbd?',
    body: h('div', { class: 'list' }, ...sabs.map((s) => h('button', {
      class: 'btn', style: { display: 'block', width: '100%', marginBottom: '8px', textAlign: 'left' },
      onclick: () => { closeModal(); send(s); },
    }, s.label))),
  });
}

function notConfigured(svc) {
  return h('div', { class: 'empty', style: { padding: '48px 24px' } },
    h('div', { class: 'empty-icon' }, '🔍'),
    h('div', { style: { fontWeight: '700', fontSize: '16px' } }, 'Indexer isn’t configured yet'),
    h('div', { class: 'dim', style: { marginTop: '10px', maxWidth: '560px', lineHeight: '1.6' } },
      'Set the Indexer API Host (URL) and Indexer API Key under ',
      h('span', { class: 'mono' }, `services.${svc.key}`),
      ' in config.json — works with public indexers like NZBGeek, and no custom headers are needed — then restart.'),
  );
}
