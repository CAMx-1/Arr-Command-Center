import { h, mount, clear, empty, toast, fmtBytes, openModal } from '../lib/ui.js';

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
      return renderReleases(body, arr, releases);
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

function renderReleases(root, arr, releases) {
  if (!Array.isArray(releases) || !releases.length) {
    return mount(root, empty('', 'No releases found', 'No indexer returned results for this search.'));
  }
  // Approved first, then largest (usually best quality) first.
  releases.sort((a, b) => (Number(b.approved) - Number(a.approved)) || ((b.size || 0) - (a.size || 0)));
  const header = h('div', { class: 'meta-line', style: { marginBottom: '12px' } },
    h('span', {}, h('b', {}, String(releases.length)), ' releases'),
    h('span', { class: 'dim' }, 'sorted by approved, then size'),
  );
  mount(root, header, h('div', { class: 'list' }, ...releases.map((r) => releaseRow(r, arr))));
}

function fmtAge(hours) {
  const hrs = Number(hours) || 0;
  if (hrs < 48) return `${Math.round(hrs)}h old`;
  return `${Math.round(hrs / 24)}d old`;
}

function releaseRow(rel, arr) {
  const isTorrent = rel.protocol === 'torrent';
  const rejections = rel.rejections || [];
  const grabBtn = h('button', { class: 'btn sm primary', onclick: async (ev) => {
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
