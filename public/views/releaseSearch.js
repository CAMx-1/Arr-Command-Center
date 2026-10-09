import { h, mount, clear, empty, toast, fmtBytes, openModal } from '../lib/ui.js';
import { RESOLUTIONS, loadReleaseFilters, saveReleaseFilters, filterReleases, isDefaultFilters, DEFAULT_FILTERS } from '../lib/releaseFilters.js';
import { dismissKeyboardOnEnter } from '../lib/nativeApp.js';

// Shared interactive search: fetches releases from indexers and lets you grab one.
// Works for both Sonarr and Radarr (identical /release endpoint + grab semantics).
//   query examples: `episodeId=123`, `seriesId=1&seasonNumber=2`, `movieId=5`
export async function openReleaseSearch(ctx, arrKey, query, title) {
  const arr = ctx.api.arr(arrKey);
  const body = h('div', {}, loadingBox());
  openModal({ title: `Interactive Search — ${title}`, body, wide: true });

  // Interactive search can hit transient Sonarr/Radarr errors (e.g. a momentary
  // "readonly database"/lock while it caches results). Retry a few times before
  // surfacing the failure — a single blip shouldn't dump the user to an error.
  const maxAttempts = 3;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const releases = await arr.get(`release?${query}`);
      return renderReleases(body, arr, releases, arrKey);
    } catch (e) {
      lastErr = e;
      const transient = e.status >= 500 || /readonly|locked|database|timed out|aborted/i.test(e.message || '');
      if (!transient || attempt === maxAttempts) break;
      mount(body, loadingBox(`Sonarr was briefly busy — retrying (${attempt}/${maxAttempts - 1})…`));
      await new Promise((r) => setTimeout(r, 1200 * attempt));
    }
  }
  reportError(body, lastErr);
}

function reportError(body, e) {
  let msg = (e && e.message) || 'Unknown error';
  if (/readonly database|readonly|unable to open database/i.test(msg)) {
    msg = "Sonarr couldn't write to its database to cache the search results. This is usually transient — try again in a moment. " +
      'If it persists, check the sonarr.db file/volume permissions and free disk space on the Sonarr host.';
  } else if (/timed out|aborted/i.test(msg)) {
    msg = 'The indexer search timed out. Try a more specific search (a single episode) or check your indexers.';
  }
  mount(body, empty('', 'Search failed', msg));
}

function loadingBox(message = 'Searching indexers… this can take up to a minute.') {
  return h('div', { class: 'empty' },
    h('div', { class: 'spinner' }),
    h('div', { class: 'dim' }, message),
  );
}

function renderReleases(root, arr, releases, svcKey) {
  if (!Array.isArray(releases) || !releases.length) {
    return mount(root, empty('', 'No releases found', 'No indexer returned results for this search.'));
  }
  // Approved first, then largest (usually best quality) first.
  releases.sort((a, b) => (Number(b.approved) - Number(a.approved)) || ((b.size || 0) - (a.size || 0)));
  let filters = loadReleaseFilters(svcKey);
  const count = h('span', {});
  const list = h('div', { class: 'list' });
  const resetBtn = h('button', { class: 'btn sm', type: 'button', onclick: () => { filters = { ...DEFAULT_FILTERS }; sync(); apply(); } }, 'Reset');

  // ---- Filter controls (remembered per service) ----
  const resChips = RESOLUTIONS.map((r) => h('button', {
    type: 'button', class: 'rf-chip', dataset: { r }, 'aria-pressed': 'false',
    onclick: () => { filters.resolutions = filters.resolutions.includes(r) ? filters.resolutions.filter((x) => x !== r) : [...filters.resolutions, r]; apply(); },
  }, r));
  const protocol = h('select', { class: 'input rf-protocol', 'aria-label': 'Protocol' },
    h('option', { value: 'any' }, 'Any protocol'), h('option', { value: 'usenet' }, 'Usenet'), h('option', { value: 'torrent' }, 'Torrent'));
  protocol.addEventListener('change', () => { filters.protocol = protocol.value; apply(); });
  const num = (ph, label, keyName) => {
    const el = dismissKeyboardOnEnter(h('input', { class: 'input rf-size', type: 'number', inputmode: 'decimal', min: '0', step: '0.5', placeholder: ph, 'aria-label': label, enterkeyhint: 'done' }));
    el.addEventListener('input', () => { filters[keyName] = el.value === '' ? '' : Math.max(0, Number(el.value)); apply(); });
    return el;
  };
  const minIn = num('Min', 'Minimum size in GB', 'minGB');
  const maxIn = num('Max', 'Maximum size in GB', 'maxGB');
  const hideRej = h('input', { type: 'checkbox' });
  hideRej.addEventListener('change', () => { filters.hideRejected = hideRej.checked; apply(); });
  const bar = h('div', { class: 'rf-bar' },
    h('div', { class: 'rf-group', role: 'group', 'aria-label': 'Resolution' }, ...resChips),
    h('div', { class: 'rf-group' }, protocol, minIn, h('span', { class: 'dim' }, '–'), maxIn, h('span', { class: 'dim' }, 'GB')),
    h('label', { class: 'rf-check' }, hideRej, 'Hide rejected'),
    resetBtn,
  );

  const sync = () => {
    for (const c of resChips) { const on = filters.resolutions.includes(c.dataset.r); c.classList.toggle('active', on); c.setAttribute('aria-pressed', String(on)); }
    protocol.value = filters.protocol;
    minIn.value = filters.minGB === '' ? '' : String(filters.minGB);
    maxIn.value = filters.maxGB === '' ? '' : String(filters.maxGB);
    hideRej.checked = filters.hideRejected;
  };
  const apply = () => {
    sync();
    saveReleaseFilters(svcKey, filters);
    const shown = filterReleases(releases, filters);
    resetBtn.disabled = isDefaultFilters(filters);
    mount(count, h('b', {}, String(shown.length)), shown.length === releases.length ? ' releases' : ` of ${releases.length} releases`);
    mount(list, ...(shown.length
      ? shown.map((r) => releaseRow(r, arr))
      : [empty('', 'No releases match these filters', `${releases.length} hidden — adjust or reset the filters`, { label: 'Reset filters', onClick: () => resetBtn.click() })]));
  };
  const header = h('div', { class: 'meta-line', style: { margin: '10px 0 12px' } }, count, h('span', { class: 'dim' }, 'sorted by approved, then size'));
  mount(root, bar, header, list);
  apply();
}

function fmtAge(hours) {
  const hrs = Number(hours) || 0;
  if (hrs < 48) return `${Math.round(hrs)}h old`;
  return `${Math.round(hrs / 24)}d old`;
}

function releaseRow(rel, arr) {
  const isTorrent = rel.protocol === 'torrent';
  const rejections = rel.rejections || [];
  const grabBtn = h('button', { class: 'btn sm primary hex-btn', onclick: async (ev) => {
    const btn = ev.currentTarget; btn.disabled = true; btn.textContent = '…';
    try {
      await arr.post('release', { guid: rel.guid, indexerId: rel.indexerId });
      btn.textContent = '✓ Grabbed'; toast('Sent to download client', 'success');
    } catch (e) { btn.disabled = false; btn.textContent = '⬇ Grab'; toast(e.message, 'error'); }
  } }, '⬇ Grab');

  return h('div', { class: 'row' },
    h('div', { class: 'row-main' },
      h('div', { class: 'release-title mono' }, rel.title),
      h('div', { class: 'meta-line', style: { marginTop: '6px' } },
        h('span', { class: 'pill info' }, (rel.quality && rel.quality.quality && rel.quality.quality.name) || '—'),
        h('span', { class: 'pill muted' }, rel.protocol || '?'),
        h('span', {}, rel.indexer || ''),
        h('span', {}, fmtBytes(rel.size || 0)),
        h('span', {}, fmtAge(rel.ageHours)),
        isTorrent ? h('span', { title: 'seeders / leechers' }, `▲ ${rel.seeders ?? 0} ▼ ${rel.leechers ?? 0}`) : null,
        rel.approved
          ? h('span', { class: 'pill ok' }, '✓ Approved')
          : h('span', { class: 'pill warn', title: rejections.join('\n') }, `Rejected${rejections.length ? ` (${rejections.length})` : ''}`),
      ),
      (!rel.approved && rejections.length) ? h('div', { class: 'release-reject dim' }, rejections[0]) : null,
    ),
    h('div', { class: 'row-actions' }, grabBtn),
  );
}
