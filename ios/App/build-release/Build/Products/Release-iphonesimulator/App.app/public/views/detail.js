import { h, mount, spinner, empty, openModal, closeModal, fmtBytes, copyable } from '../lib/ui.js';
import { cachedGet } from '../lib/cache.js';

const TMDB_IMG = 'https://image.tmdb.org/t/p/';
const img = (path, size) => (path ? `${TMDB_IMG}${size}${path}` : null);

function findMetadataProvider(ctx) {
  // Seerr (Overseerr/Jellyseerr) exposes rich TMDB data (incl. cast) via its API.
  return ctx.state.services.find((s) => s.type === 'overseerr');
}

// Open a details popout for a movie/show.
//   opts: { mediaType: 'movie'|'tv', tmdbId, fallback: { title, year, overview, genres, rating, posterUrl } }
export async function openDetailModal(ctx, opts) {
  const { mediaType, tmdbId, fallback = {} } = opts;
  const body = h('div', {}, spinner());
  openModal({ title: fallback.title || 'Details', body, wide: true });

  let data = null;
  const provider = findMetadataProvider(ctx);
  if (provider && tmdbId) {
    try {
      data = await ctx.api.seerr(provider.key).get(`${mediaType === 'tv' ? 'tv' : 'movie'}/${tmdbId}`);
    } catch { /* fall back below */ }
  }
  renderDetail(body, data, fallback, mediaType, !!provider);
}

function renderDetail(root, data, fallback, mediaType, hasProvider) {
  // Merge live TMDB data over the fallback fields.
  const title = (data && (data.title || data.name)) || fallback.title || 'Unknown';
  const dateStr = (data && (data.releaseDate || data.firstAirDate)) || fallback.date || '';
  const year = dateStr ? new Date(dateStr).getFullYear() : (fallback.year || '');
  const overview = (data && data.overview) || fallback.overview || 'No description available.';
  const tagline = data && data.tagline;
  const genres = (data && (data.genres || []).map((g) => g.name)) || fallback.genres || [];
  const rating = data ? data.voteAverage : fallback.rating;
  const voteCount = data && data.voteCount;
  const runtime = data ? (data.runtime || (data.episodeRunTime && data.episodeRunTime[0])) : fallback.runtime;
  const status = data && data.status;
  const posterUrl = img(data && data.posterPath, 'w300') || fallback.posterUrl;
  const backdropUrl = img(data && data.backdropPath, 'w780');
  const cast = (data && data.credits && data.credits.cast) || [];

  const hero = h('div', { class: 'detail-hero', style: backdropUrl ? { backgroundImage: `linear-gradient(180deg, rgba(20,22,38,0.35), rgba(20,22,38,0.92)), url("${backdropUrl}")` } : {} },
    h('div', { class: 'detail-hero-inner' },
      posterUrl ? h('img', { class: 'detail-poster', src: posterUrl, alt: '' }) : h('div', { class: 'detail-poster placeholder' }, mediaType === 'tv' ? '' : ''),
      h('div', { class: 'detail-heading' },
        h('div', { class: 'detail-title' }, title, year ? h('span', { class: 'detail-year' }, ` (${year})`) : null),
        tagline ? h('div', { class: 'detail-tagline' }, tagline) : null,
        h('div', { class: 'detail-badges' },
          (rating != null && rating !== 0) ? h('span', { class: 'rating-badge' }, '★ ', Number(rating).toFixed(1), voteCount ? h('span', { class: 'dim' }, ` (${formatCount(voteCount)})`) : null) : null,
          runtime ? h('span', { class: 'pill muted' }, `${runtime} min`) : null,
          status ? h('span', { class: 'pill info' }, status) : null,
          h('span', { class: 'pill muted' }, mediaType === 'tv' ? 'TV' : 'Movie'),
        ),
        genres.length ? h('div', { class: 'detail-genres' }, ...genres.slice(0, 5).map((g) => h('span', { class: 'genre-chip' }, g))) : null,
      ),
    ),
  );

  const overviewEl = h('div', { class: 'detail-section' },
    h('div', { class: 'section-title' }, 'Overview'),
    h('p', { class: 'detail-overview' }, overview),
  );

  let castEl;
  if (cast.length) {
    castEl = h('div', { class: 'detail-section' },
      h('div', { class: 'section-title' }, 'Cast'),
      h('div', { class: 'cast-strip' }, ...cast.slice(0, 20).map(castCard)),
    );
  } else if (!hasProvider) {
    castEl = h('div', { class: 'detail-section' }, h('div', { class: 'dim', style: { fontSize: '13px' } }, 'Cast info needs a Seerr service configured.'));
  } else {
    castEl = null;
  }

  mount(root, hero, overviewEl, castEl);
}

function castCard(person) {
  const photo = img(person.profilePath, 'w185');
  return h('div', { class: 'cast-card' },
    photo ? h('img', { class: 'cast-photo', src: photo, alt: '', loading: 'lazy', onerror: function () { this.replaceWith(h('div', { class: 'cast-photo placeholder' }, '')); } }) : h('div', { class: 'cast-photo placeholder' }, ''),
    h('div', { class: 'cast-name' }, person.name),
    person.character ? h('div', { class: 'cast-char' }, person.character) : null,
  );
}

function formatCount(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k votes`;
  return `${n} votes`;
}

// Storage / file info modal for a Sonarr series or Radarr movie (the "Info"
// action). `item` is the raw arr resource; `isTv` selects series vs movie fields.
function arrInfoRow(label, value) {
  return h('div', { class: 'setting-row' },
    h('span', { class: 'dim' }, label),
    h('span', { class: 'right', style: { textAlign: 'right', maxWidth: '72%', wordBreak: 'break-all' } }, value),
  );
}

export function openArrFileInfo(label, isTv, item, arr) {
  const stats = item.statistics || {};
  const hasFile = isTv ? (stats.episodeFileCount > 0) : item.hasFile;
  const size = isTv ? stats.sizeOnDisk : item.sizeOnDisk;
  const mf = item.movieFile;
  const quality = mf && mf.quality && mf.quality.quality && mf.quality.quality.name;
  const rows = [
    arrInfoRow('Service', label),
    arrInfoRow('Status', hasFile ? 'Downloaded' : 'Missing'),
  ];
  if (item.path) rows.push(arrInfoRow('Stored in', copyable(item.path)));
  if (size) rows.push(arrInfoRow('Size on disk', fmtBytes(size)));
  if (!isTv && mf) {
    if (mf.relativePath) rows.push(arrInfoRow('Grabbed file', copyable(mf.relativePath)));
    if (mf.size) rows.push(arrInfoRow('File size', fmtBytes(mf.size)));
    if (quality) rows.push(arrInfoRow('Quality', quality));
  }
  if (isTv && item.statistics) rows.push(arrInfoRow('Episodes on disk', `${stats.episodeFileCount ?? 0} / ${stats.episodeCount ?? 0}`));
  const body = h('div', {}, ...rows);
  // For TV, list the individual episode files (path, size, quality) on demand.
  let filesEl = null;
  if (isTv && arr && item.id) {
    filesEl = h('div', { style: { marginTop: '16px' } }, h('div', { class: 'section-title', style: { margin: '0 0 8px' } }, 'Files'), spinner());
    body.appendChild(filesEl);
  }
  openModal({
    title: `${item.title}${item.year ? ` (${item.year})` : ''}`,
    body,
    footer: h('div', { style: { display: 'flex', justifyContent: 'flex-end', width: '100%' } },
      h('button', { class: 'btn', onclick: closeModal }, 'Close'),
    ),
  });
  if (filesEl) {
    cachedGet(`arr:${item.id}:episodefile`, () => arr.get(`episodefile?seriesId=${item.id}`), 120000)
      .then((files) => {
        const list = (files || []).slice().sort((a, b) => String(a.relativePath || '').localeCompare(String(b.relativePath || '')));
        if (!list.length) { mount(filesEl, h('div', { class: 'section-title', style: { margin: '0 0 8px' } }, 'Files'), h('div', { class: 'dim' }, 'No files on disk')); return; }
        mount(filesEl,
          h('div', { class: 'section-title', style: { margin: '0 0 8px' } }, `Files (${list.length})`),
          h('div', { class: 'list', style: { maxHeight: '340px', overflowY: 'auto' } }, ...list.map(episodeFileRow)),
        );
      })
      .catch(() => { mount(filesEl, h('div', { class: 'section-title', style: { margin: '0 0 8px' } }, 'Files'), h('div', { class: 'dim' }, 'Could not load files')); });
  }
}

function episodeFileRow(f) {
  const q = f.quality && f.quality.quality && f.quality.quality.name;
  return h('div', { class: 'row' },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title', style: { fontSize: '13px' } }, copyable(f.relativePath || `Season ${f.seasonNumber}`)),
      h('div', { class: 'meta-line', style: { marginTop: '2px' } },
        f.seasonNumber != null ? h('span', { class: 'pill muted' }, `S${String(f.seasonNumber).padStart(2, '0')}`) : null,
        f.size ? h('span', {}, fmtBytes(f.size)) : null,
        q ? h('span', { class: 'pill info' }, q) : null,
      ),
    ),
  );
}
