import { h, mount, clear, toast, empty, spinner, fmtBytes, fmtRelative, debounce, openModal, closeModal } from '../lib/ui.js';

// Usenet indexer search — LunaSea-style "Search" for public indexers such as
// NZBGeek (Indexer API Host + Indexer API Key). Public indexers expose the
// standard Newznab API (?apikey=, t=search, cat=...), so the same host/key/
// category mechanism works across them. Results can be grabbed straight to a
// configured SABnzbd instance. Tuned for audiobooks, with book and audio filters.

// Category groups (standard indexer scheme). Sending cat=<group> (a *000 value)
// matches all of its subcategories; specific subcats are listed to be safe
// across indexers that don't expand groups.
const CATEGORIES = [
  { id: 'audiobooks', label: 'Audiobooks', cat: '3030' },
  { id: 'books', label: 'Books / eBooks / Comics / Magazines', cat: '7000,7010,7020,7030,7040' },
  { id: 'audio', label: 'Audio', cat: '3000,3010,3020,3040' },
  { id: 'all', label: 'All', cat: '' },
];

function catLabel(c) {
  const n = Number(c);
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
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

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
    h('div', { class: 'row-actions' },
      (it.comments || it.details) ? h('button', { class: 'btn sm', title: 'Read comments on the indexer', onclick: () => openLink(it.comments || it.details) }, `💬${it.commentsCount ? ` ${it.commentsCount}` : ''}`) : null,
      h('button', { class: 'btn sm', title: 'View details', onclick: () => openDetailsModal(it, ctx) }, 'Details'),
      h('button', { class: 'btn sm primary', title: 'Send to SABnzbd', disabled: it.url ? null : 'disabled', onclick: () => sendToSab(ctx, it) }, '＋ Send to SAB'),
    ),
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
    (it.comments || it.details) ? h('button', { class: 'btn', title: 'Read comments on the indexer', onclick: () => openLink(it.comments || it.details) }, `💬 Comments${it.commentsCount ? ` (${it.commentsCount})` : ''}`) : null,
    it.details ? h('button', { class: 'btn', title: 'Open the release page on the indexer', onclick: () => openLink(it.details) }, '↗ View on indexer') : null,
    h('button', { class: 'btn primary', disabled: it.url ? null : 'disabled', onclick: () => { closeModal(); sendToSab(ctx, it); } }, '＋ Send to SAB'),
  );
  openModal({ title: it.title, body, footer, wide: true });
}

function sabInstances(ctx) {
  return (ctx.state.services || []).filter((s) => s.type === 'sabnzbd' && s.configured);
}

async function sendToSab(ctx, it) {
  const sabs = sabInstances(ctx);
  if (!sabs.length) { toast('No SABnzbd service is configured', 'error'); return; }
  const send = async (svc) => {
    try {
      await ctx.api.sab(svc.key, { mode: 'addurl', name: it.url, nzbname: it.title });
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
