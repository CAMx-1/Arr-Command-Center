// Release profiles (must / must not contain terms) and delay profiles for
// Sonarr and Radarr. Pure helpers plus the System-tab sections and editors.
import { h, mount, toast, openModal, closeModal } from './ui.js';
import { roleAllows } from './roleUi.js';

export const DEFAULT_DELAY_ORDER = 2147483647;

// Sonarr 5 lets a release profile use several indexers (indexerIds). Its old
// v3 API shows only the first, and saving "All indexers" through it stores
// indexer 0, which matches no indexer, so the profile silently stops
// applying. Sonarr 5 and newer are read and saved through /api/v5 instead.
export function releaseProfilesV5(type, version) {
  return type === 'sonarr' && Number(String(version || '').split('.')[0]) >= 5;
}

// Older Sonarr (v3) sends terms as one comma string; v4/Radarr send arrays.
export function termsOf(v) {
  if (Array.isArray(v)) return v.map((t) => (typeof t === 'string' ? t : t && t.key) || '').map((t) => t.trim()).filter(Boolean);
  return String(v || '').split(',').map((t) => t.trim()).filter(Boolean);
}
export function parseTerms(text) {
  const out = [];
  for (const t of String(text || '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean)) if (!out.includes(t)) out.push(t);
  return out;
}

export function validateRelease(r) {
  const errors = [];
  // Sonarr 5's air-date and season-pack options work without any terms.
  const rules = !!(r.airDateRestriction || r.allowSeasonPackWithoutAllEpisodesAired);
  if (!termsOf(r.required).length && !termsOf(r.ignored).length && !rules) errors.push('Add at least one “must contain” or “must not contain” term.');
  for (const t of [...termsOf(r.required), ...termsOf(r.ignored)]) {
    if (/^\/.*\/[a-z]*$/i.test(t)) { try { new RegExp(t.replace(/^\/(.*)\/[a-z]*$/i, '$1')); } catch { errors.push(`“${t}” isn’t a valid regular expression.`); } }
  }
  return errors;
}

export function validateDelay(d) {
  const errors = [];
  if (!d.enableUsenet && !d.enableTorrent) errors.push('Allow at least one of Usenet or torrents.');
  for (const k of ['usenetDelay', 'torrentDelay']) if (!Number.isInteger(Number(d[k])) || Number(d[k]) < 0) errors.push(`${k === 'usenetDelay' ? 'Usenet' : 'Torrent'} delay must be 0 or more minutes.`);
  if (d.order !== DEFAULT_DELAY_ORDER && !(d.tags || []).length) errors.push('Only the default delay profile can have no tags.');
  return errors;
}

export const isDefaultDelay = (d) => d.order === DEFAULT_DELAY_ORDER || d.id === 1;
export function sortDelays(list) { return (list || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)); }

export function fmtMinutes(n) {
  const m = Number(n) || 0;
  if (!m) return 'no delay';
  if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? '' : 's'}`;
  if (m % 60 === 0) return `${m / 60} hour${m === 60 ? '' : 's'}`;
  return `${m} min`;
}

export function delaySummary(d) {
  const parts = [];
  if (d.enableUsenet && d.enableTorrent) parts.push(`prefer ${d.preferredProtocol === 'torrent' ? 'torrent' : 'Usenet'}`);
  else parts.push(d.enableUsenet ? 'Usenet only' : 'torrents only');
  if (d.enableUsenet) parts.push(`Usenet ${fmtMinutes(d.usenetDelay)}`);
  if (d.enableTorrent) parts.push(`torrent ${fmtMinutes(d.torrentDelay)}`);
  if (d.bypassIfHighestQuality) parts.push('skip delay for top quality');
  if (d.bypassIfAboveCustomFormatScore) parts.push(`skip delay at score ${d.minimumCustomFormatScore || 0}+`);
  return parts.join(' · ');
}

// Sonarr 5's extra release profile options, as short phrases.
export function releaseExtras(r, tags = []) {
  const out = [];
  if ((r.excludedTags || []).length) out.push(`except tags: ${tagNames(r.excludedTags, tags).join(', ')}`);
  if (r.airDateRestriction) {
    const g = Number(r.airDateGracePeriod) || 0;
    out.push(`rejects unaired releases${g ? ` (grace ${g} hour${Math.abs(g) === 1 ? '' : 's'})` : ''}`);
  }
  if (r.allowSeasonPackWithoutAllEpisodesAired) out.push('season packs before every episode airs');
  return out;
}
// Sonarr 5 profile saved through the v3 API with "All indexers" (by an older
// version of this app or another tool): indexer 0 matches no indexer, so the
// profile isn't applied at all. Saving it here (v5) repairs it.
export const releaseOnNoIndexer = (r) => Array.isArray(r && r.indexerIds) && r.indexerIds.includes(0);
const NO_INDEXER = 'Sonarr has this profile on indexer 0, which matches no indexer, so it isn’t applied to any release. It was probably saved through Sonarr’s old v3 API with “All indexers”.';

// Indexer names for a profile: indexerIds (Sonarr 5) or indexerId (older).
export function releaseIndexers(r, indexers = []) {
  const ids = Array.isArray(r.indexerIds) ? r.indexerIds : (r.indexerId ? [r.indexerId] : []);
  return ids.filter((id) => id > 0).map((id) => ((indexers || []).find((i) => i.id === id) || {}).name || `#${id}`);
}

// ------------------------------------------------------------------ UI
function tagNames(ids, tags) { return (ids || []).map((id) => ((tags || []).find((t) => t.id === id) || {}).label || `#${id}`); }
const field = (label, input, hint) => h('label', { style: { display: 'grid', gap: '4px', fontSize: '13px' } }, h('span', {}, label), input, hint ? h('span', { class: 'dim', style: { fontSize: '11px' } }, hint) : null);

function tagPicker(tags, selected) {
  const sel = new Set(selected || []);
  const box = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } }, ...(tags.length ? tags.map((t) => h('label', { class: 'pill muted', style: { cursor: 'pointer', gap: '4px', display: 'inline-flex', alignItems: 'center' } },
    h('input', { type: 'checkbox', checked: sel.has(t.id) ? 'checked' : null, onchange: (e) => { if (e.target.checked) sel.add(t.id); else sel.delete(t.id); } }), t.label)) : [h('span', { class: 'dim', style: { fontSize: '12px' } }, 'No tags yet. Create tags in the Tags section.')]));
  return { el: box, value: () => [...sel] };
}

function indexerPicker(indexers, selected) {
  const sel = new Set((selected || []).filter((id) => id > 0));
  const box = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } }, ...((indexers || []).length ? indexers.map((i) => h('label', { class: 'pill muted', style: { cursor: 'pointer', gap: '4px', display: 'inline-flex', alignItems: 'center' } },
    h('input', { type: 'checkbox', checked: sel.has(i.id) ? 'checked' : null, onchange: (e) => { if (e.target.checked) sel.add(i.id); else sel.delete(i.id); } }), i.name)) : [h('span', { class: 'dim', style: { fontSize: '12px' } }, 'No indexers to choose from.')]));
  return { el: box, value: () => [...sel] };
}

async function save(arr, path, item, reload, label) {
  try {
    if (item.id) await arr.put(`${path}/${item.id}`, item); else await arr.post(path, item);
    toast(`${label} saved`, 'success'); closeModal(); reload();
  } catch (e) { toast(e.message, 'error'); }
}
async function remove(arr, path, item, reload, label, btn) {
  if (btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.textContent = 'Delete?'; setTimeout(() => { btn.dataset.armed = ''; btn.textContent = 'Delete'; }, 5000); return; }
  try { await arr.del(`${path}/${item.id}`); toast(`${label} deleted`, 'success'); reload(); }
  catch (e) { toast(e.message, 'error'); }
}

export function editRelease(original, { arr, tags, indexers, reload, multiIndexer = false }) {
  // Sonarr 5's v5 API refuses a new profile without airDateGracePeriod.
  const fresh = multiIndexer ? { indexerIds: [], excludedTags: [], airDateRestriction: false, airDateGracePeriod: 0, allowSeasonPackWithoutAllEpisodesAired: false } : { indexerId: 0 };
  const r = { enabled: true, required: [], ignored: [], tags: [], ...fresh, ...structuredClone(original || {}) };
  const asArrays = original ? Array.isArray(original.required) || Array.isArray(original.ignored) : true;
  const name = h('input', { class: 'input', value: r.name || '', placeholder: 'e.g. No cams' });
  const req = h('textarea', { class: 'input', rows: 3, placeholder: 'One per line, or /regex/i' }, termsOf(r.required).join('\n'));
  const ign = h('textarea', { class: 'input', rows: 3, placeholder: 'One per line, or /regex/i' }, termsOf(r.ignored).join('\n'));
  const enabled = h('input', { type: 'checkbox', role: 'switch', checked: r.enabled !== false ? 'checked' : null });
  // One indexer (older Sonarr, Radarr) or any number (Sonarr 5; none ticked = all).
  const idx = multiIndexer ? null : h('select', { class: 'input' }, h('option', { value: '0' }, 'All indexers'), ...(indexers || []).map((i) => h('option', { value: String(i.id), selected: i.id === r.indexerId ? 'selected' : null }, i.name)));
  const ixp = multiIndexer ? indexerPicker(indexers, r.indexerIds) : null;
  const tp = tagPicker(tags, r.tags);
  const extras = releaseExtras(r, tags);
  const err = h('div', { class: 'dim', style: { color: 'var(--down, #e11d48)', fontSize: '12px' } });
  const submit = () => {
    const out = { ...r, name: name.value.trim(), enabled: enabled.checked, tags: tp.value() };
    if (multiIndexer) { out.indexerIds = ixp.value(); delete out.indexerId; } else out.indexerId = Number(idx.value) || 0;
    out.required = asArrays ? parseTerms(req.value) : parseTerms(req.value).join(',');
    out.ignored = asArrays ? parseTerms(ign.value) : parseTerms(ign.value).join(',');
    const errors = validateRelease(out);
    if (errors.length) { err.textContent = errors.join(' '); return; }
    save(arr, 'releaseprofile', out, reload, 'Release profile');
  };
  openModal({ title: original ? `Edit release profile${r.name ? ` — ${r.name}` : ''}` : 'New release profile', body: h('div', { style: { display: 'grid', gap: '10px' } },
    field('Name', name), field('Must contain', req, 'A release needs at least one of these.'), field('Must not contain', ign, 'A release with any of these is rejected.'),
    multiIndexer ? field('Indexers', ixp.el, 'With none ticked it applies to every indexer.') : field('Indexer', idx), field('Tags', tp.el, 'With no tags it applies to everything.'),
    extras.length ? h('p', { class: 'dim', style: { fontSize: '12px', margin: 0 } }, `Also set in Sonarr: ${extras.join('; ')}. Saving here keeps them.`) : null,
    multiIndexer && releaseOnNoIndexer(r) ? h('p', { style: { fontSize: '12px', margin: 0, color: 'var(--warn, #b45309)' } }, `${NO_INDEXER} Saving applies it to the indexers ticked above (none ticked: every indexer).`) : null,
    h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '13px' } }, enabled, 'Enabled'), err),
  footer: h('div', { style: { display: 'flex', gap: '8px' } }, h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn primary', onclick: submit }, 'Save')) });
}

export function editDelay(original, { arr, tags, reload }) {
  const d = { enableUsenet: true, enableTorrent: true, preferredProtocol: 'usenet', usenetDelay: 0, torrentDelay: 0, bypassIfHighestQuality: true, bypassIfAboveCustomFormatScore: false, minimumCustomFormatScore: 0, tags: [], ...structuredClone(original || {}) };
  const isDefault = original && isDefaultDelay(original);
  const proto = h('select', { class: 'input' }, ...[['usenet', 'Prefer Usenet'], ['torrent', 'Prefer torrent'], ['onlyUsenet', 'Only Usenet'], ['onlyTorrent', 'Only torrent']].map(([v, l]) => h('option', { value: v }, l)));
  proto.value = !d.enableTorrent ? 'onlyUsenet' : !d.enableUsenet ? 'onlyTorrent' : d.preferredProtocol === 'torrent' ? 'torrent' : 'usenet';
  const num = (v) => h('input', { class: 'input', type: 'number', min: '0', step: '1', value: String(v || 0) });
  const ud = num(d.usenetDelay); const td = num(d.torrentDelay); const minScore = num(d.minimumCustomFormatScore);
  const bypassQ = h('input', { type: 'checkbox', role: 'switch', checked: d.bypassIfHighestQuality ? 'checked' : null });
  const bypassS = h('input', { type: 'checkbox', role: 'switch', checked: d.bypassIfAboveCustomFormatScore ? 'checked' : null });
  const tp = isDefault ? null : tagPicker(tags, d.tags);
  const err = h('div', { class: 'dim', style: { color: 'var(--down, #e11d48)', fontSize: '12px' } });
  const submit = () => {
    const p = proto.value;
    const out = { ...d, enableUsenet: p !== 'onlyTorrent', enableTorrent: p !== 'onlyUsenet', preferredProtocol: p === 'torrent' || p === 'onlyTorrent' ? 'torrent' : 'usenet',
      usenetDelay: Number(ud.value), torrentDelay: Number(td.value), bypassIfHighestQuality: bypassQ.checked, bypassIfAboveCustomFormatScore: bypassS.checked, minimumCustomFormatScore: Number(minScore.value) || 0,
      tags: tp ? tp.value() : [] };
    if (!original) delete out.order; // the app places new ones above the default
    const errors = validateDelay(original ? out : { ...out, order: 1 });
    if (errors.length) { err.textContent = errors.join(' '); return; }
    save(arr, 'delayprofile', out, reload, 'Delay profile');
  };
  const check = (el, t) => h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '13px' } }, el, t);
  openModal({ title: isDefault ? 'Edit default delay profile' : original ? 'Edit delay profile' : 'New delay profile', body: h('div', { style: { display: 'grid', gap: '10px' } },
    field('Protocol', proto), h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } }, field('Usenet delay (minutes)', ud), field('Torrent delay (minutes)', td)),
    check(bypassQ, 'Skip the delay when the release is the highest allowed quality'),
    check(bypassS, 'Skip the delay when the custom format score is at least'), field('Minimum score to skip', minScore),
    tp ? field('Tags', tp.el, 'Needs at least one tag. Items with these tags use this profile.') : h('p', { class: 'dim', style: { fontSize: '12px' } }, 'The default profile applies to everything without a more specific tagged profile.'), err),
  footer: h('div', { style: { display: 'flex', gap: '8px' } }, h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn primary', onclick: submit }, 'Save')) });
}

// arr: the client release profiles are read and saved with (Sonarr 5: /api/v5).
export function releaseSection({ releases, tags, indexers, arr, reload, multiIndexer = false }) {
  const admin = roleAllows('admin');
  const list = releases || [];
  const deps = { arr, tags: tags || [], indexers, reload, multiIndexer };
  return h('div', {},
    admin ? h('div', { style: { margin: '0 0 6px' } }, h('button', { class: 'btn sm', onclick: () => editRelease(null, deps) }, '+ Release profile')) : null,
    list.length ? h('div', { class: 'list' }, ...list.map((r) => {
      const req = termsOf(r.required); const ign = termsOf(r.ignored); const ixNames = releaseIndexers(r, indexers);
      const del = admin ? h('button', { class: 'btn sm danger', onclick: () => remove(arr, 'releaseprofile', r, reload, 'Release profile', del) }, 'Delete') : null;
      return h('div', { class: 'row', style: { alignItems: 'flex-start' } },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', style: { fontSize: '14px' } }, r.name || 'Unnamed', ' ', r.enabled === false ? h('span', { class: 'pill muted' }, 'off') : null,
            releaseOnNoIndexer(r) ? h('span', { class: 'pill warn', title: `${NO_INDEXER} Edit and save it here to fix it.` }, 'applies to no indexer') : null),
          h('div', { class: 'meta-line', style: { flexWrap: 'wrap', marginTop: '2px' } },
            ...req.map((t) => h('span', { class: 'pill ok', title: 'Must contain' }, `+ ${t}`)),
            ...ign.map((t) => h('span', { class: 'pill down', title: 'Must not contain' }, `− ${t}`)),
            h('span', { class: 'dim' }, (r.tags || []).length ? `tags: ${tagNames(r.tags, deps.tags).join(', ')}` : 'all items'),
            ixNames.length ? h('span', { class: 'dim' }, `${ixNames.length === 1 ? 'indexer' : 'indexers'}: ${ixNames.join(', ')}`) : null,
            ...releaseExtras(r, deps.tags).map((x) => h('span', { class: 'dim' }, x)))),
        admin ? h('div', { class: 'row-actions' }, h('button', { class: 'btn sm', onclick: () => editRelease(r, deps) }, 'Edit'), del) : null);
    })) : h('div', { class: 'dim' }, 'No release profiles.'));
}

export function delaySection({ delays, tags, arr, reload }) {
  const admin = roleAllows('admin');
  const deps = { arr, tags: tags || [], reload };
  return h('div', {},
    admin ? h('div', { style: { margin: '0 0 6px' } }, h('button', { class: 'btn sm', onclick: () => editDelay(null, deps) }, '+ Delay profile')) : null,
    h('div', { class: 'list' }, ...sortDelays(delays).map((d) => {
      const def = isDefaultDelay(d);
      const del = admin && !def ? h('button', { class: 'btn sm danger', onclick: () => remove(arr, 'delayprofile', d, reload, 'Delay profile', del) }, 'Delete') : null;
      return h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', style: { fontSize: '14px' } }, def ? 'Default' : `Tags: ${tagNames(d.tags, deps.tags).join(', ')}`),
          h('div', { class: 'dim', style: { fontSize: '12px' } }, delaySummary(d))),
        admin ? h('div', { class: 'row-actions' }, h('button', { class: 'btn sm', onclick: () => editDelay(d, deps) }, 'Edit'), del) : null);
    })),
    h('p', { class: 'dim', style: { fontSize: '12px', margin: '6px 0 0' } }, 'Tagged profiles are checked first; anything without a matching tag uses the default.'));
}
