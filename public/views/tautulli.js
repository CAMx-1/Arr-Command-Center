import { h, mount, tabs, spinner, skeletonList, empty, pct, poster, toast, timeEl, openModal, closeModal } from '../lib/ui.js';
import { viewToggle, effectiveMode } from '../lib/viewMode.js';
import { hive, posterHexCard } from '../lib/hive.js';

export async function renderTautulli(root, ctx) {
  const svc = ctx.service;
  const tau = ctx.api.tautulli(svc.key);
  ctx.setActions(viewToggle(svc.key, ctx.reload));

  const body = h('div', {});
  const bar = tabs(body, [
    { id: 'streams', label: 'Active Streams', render: (c) => tabStreams(c, tau, svc.key) },
    { id: 'history', label: 'History', render: (c) => tabHistory(c, tau, svc.key) },
    { id: 'stats', label: 'Statistics', render: (c) => tabStats(c, tau, svc.key) },
  ], `tabs-${svc.key}`);
  mount(root, bar, body);
}

// Build a poster URL that streams through our proxy (auth + CF headers injected).
function imgUrl(svcKey, thumb, w = 300, h = 450) {
  if (!thumb) return null;
  const qs = new URLSearchParams({ cmd: 'pms_image_proxy', img: thumb, width: String(w), height: String(h), fallback: 'poster' });
  return `/api/proxy/${svcKey}/api/v2?${qs.toString()}`;
}

function fmtBandwidth(kbps) {
  const n = Number(kbps) || 0;
  if (n >= 1000) return `${(n / 1000).toFixed(1)} Mbps`;
  return `${n} kbps`;
}

// ---------------- Active Streams ----------------
async function tabStreams(root, tau, svcKey) {
  mount(root, skeletonList());
  try {
    const data = await tau.get('get_activity');
    const sessions = data.sessions || [];
    const header = h('div', { class: 'honeycomb' }, h('div', { class: 'hc-row' },
      statCard('Streams', data.stream_count || sessions.length),
      statCard('Direct Play', data.stream_count_direct_play ?? '—'),
      statCard('Bandwidth', fmtBandwidth(data.total_bandwidth)),
    ));
    if (!sessions.length) {
      return mount(root, header, empty('', 'No active streams', 'Nobody is watching right now'));
    }
    const nowPlaying = effectiveMode(svcKey) === 'list'
      ? h('div', { class: 'list' }, ...sessions.map((s) => streamListRow(s, tau, svcKey, () => tabStreams(root, tau, svcKey))))
      : streamHive(sessions.map((s) => streamHex(s, tau, svcKey, () => tabStreams(root, tau, svcKey))), root.clientWidth);
    mount(root, header, h('div', { class: 'section-title' }, 'Now Playing'), nowPlaying);
  } catch (err) {
    mount(root, empty('', 'Failed to load activity', err.message, { label: 'Retry', onClick: () => tabStreams(root, tau, svcKey) }));
  }
}

function statCard(label, value) {
  return h('div', { class: 'hex-cell hex-static' },
    h('div', { class: 'hex-border' }),
    h('div', { class: 'hex-face' },
      h('div', { class: 'hex-inner' },
        h('div', { class: 'stat' },
          h('span', { class: 'stat-value' }, String(value)),
          h('span', { class: 'stat-label' }, label),
        ),
      ),
    ),
  );
}

function stateInfo(state) {
  if (state === 'playing') return { icon: '', cls: 'ok' };
  if (state === 'paused') return { icon: '', cls: 'warn' };
  if (state === 'buffering') return { icon: '', cls: 'info' };
  return { icon: '•', cls: 'muted' };
}

function streamListRow(s, tau, svcKey, reload) {
  const st = stateInfo(s.state);
  const isTranscode = (s.transcode_decision || '').toLowerCase().includes('transcode');
  const progress = Number(s.progress_percent) || 0;
  const resRaw = s.stream_video_resolution || s.video_resolution || '';
  const res = /^\d+$/.test(resRaw) ? `${resRaw}p` : resRaw;
  const posterThumb = s.grandparent_thumb || s.thumb;
  return h('div', { class: 'row clickable', onclick: () => openStreamModal(s, svcKey) },
    poster(imgUrl(svcKey, posterThumb), ''),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, s.full_title || s.title),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: `pill ${st.cls}` }, s.state || 'unknown'),
        h('span', {}, `${s.friendly_name || s.user || 'unknown'}`),
        h('span', {}, s.player || ''),
        h('span', { class: `pill ${isTranscode ? 'warn' : 'ok'}` }, isTranscode ? 'Transcode' : 'Direct Play'),
        res ? h('span', {}, res) : null,
      ),
      h('div', { class: 'progress' }, h('span', { style: { width: pct(progress) } })),
    ),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn sm danger', title: 'Stop this stream', onclick: (e) => { e.stopPropagation(); confirmStop(s, tau, reload); } }, '⏹ Stop'),
    ),
  );
}

function streamHex(s, tau, svcKey, reload) {
  const isTranscode = (s.transcode_decision || '').toLowerCase().includes('transcode');
  const progress = Number(s.progress_percent) || 0;
  const overlay = h('div', { class: 'hx-overlay' },
    h('div', { class: 'hx-title' }, s.full_title || s.title),
    h('div', { class: 'hx-sub' }, `${s.friendly_name || s.user || 'unknown'} · ${s.state || ''}`),
    h('span', { class: `pill ${isTranscode ? 'warn' : 'ok'}` }, isTranscode ? 'Transcode' : 'Direct Play'),
    h('div', { class: 'progress' }, h('span', { style: { width: pct(progress) } })),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn sm danger', title: 'Stop this stream', onclick: (e) => { e.stopPropagation(); confirmStop(s, tau, reload); } }, '⏹ Stop'),
    ),
  );
  const face = h('div', { class: 'hx-face' }, overlay);
  const url = imgUrl(svcKey, s.grandparent_thumb || s.thumb);
  if (url) face.style.backgroundImage = `url(${url})`;
  return h('div', { class: 'seerr-hex', title: 'View stream details', onclick: () => openStreamModal(s, svcKey) },
    h('div', { class: 'hx-border' }), face);
}

function streamHive(cards, viewWidth) {
  const W = 380, H = 360, colStep = Math.round(0.75 * W);
  const avail = viewWidth || (colStep + W);
  const cols = Math.max(1, Math.floor((avail - W) / colStep) + 1);
  let maxBottom = 0;
  cards.forEach((el, i) => {
    const c = i % cols, k = Math.floor(i / cols);
    const x = c * colStep, y = k * H + (c % 2) * (H / 2);
    el.style.width = `${W}px`; el.style.height = `${H}px`;
    el.style.left = `${x}px`; el.style.top = `${y}px`;
    maxBottom = Math.max(maxBottom, y + H);
  });
  const width = (cols - 1) * colStep + W;
  return h('div', { class: 'seerr-hive', style: { height: `${maxBottom + 8}px`, width: `${width}px` } }, ...cards);
}

// ---- Full stream breakdown modal ----
function mbps(kbps) { const n = Number(kbps) || 0; return `${(n / 1000).toFixed(1)} Mbps`; }
function fmtHms(ms) {
  let s = Math.floor((Number(ms) || 0) / 1000);
  const h2 = Math.floor(s / 3600); s %= 3600;
  const m = Math.floor(s / 60); s %= 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h2 > 0 ? `${h2}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
function decisionLabel(d) {
  const x = (d || '').toLowerCase();
  if (x === 'copy') return 'Direct Stream';
  if (x === 'direct play' || x === 'directplay') return 'Direct Play';
  if (x === 'transcode') return 'Transcode';
  return d || '';
}
const stripChan = (x) => (x || '').replace(/\s*\(.*?\)/, '');

function openStreamModal(s, svcKey) {
  const isTranscode = (s.transcode_decision || '').toLowerCase() === 'transcode';
  const streamLabel = (isTranscode ? 'Transcode' : decisionLabel(s.transcode_decision) || 'Direct Play') + (Number(s.transcode_throttled) ? ' (Throttled)' : '');

  const container = (s.stream_container_decision === 'transcode' || (s.container && s.stream_container && s.container !== s.stream_container))
    ? `Converting (${(s.container || '').toUpperCase()} → ${(s.stream_container || '').toUpperCase()})`
    : `Direct Play (${(s.container || '').toUpperCase()})`;

  const video = (s.stream_video_decision === 'transcode')
    ? `Transcode (${(s.video_codec || '').toUpperCase()} ${s.video_full_resolution} → ${(s.stream_video_codec || '').toUpperCase()} ${s.stream_video_full_resolution})`
    : `${decisionLabel(s.stream_video_decision || s.video_decision)} (${(s.stream_video_codec || s.video_codec || '').toUpperCase()} ${s.stream_video_full_resolution || s.video_full_resolution || ''})`;

  const lang = s.audio_language ? `${s.audio_language} - ` : '';
  const audio = (s.stream_audio_decision === 'transcode')
    ? `Transcode (${lang}${(s.audio_codec || '').toUpperCase()} ${stripChan(s.audio_channel_layout)} → ${(s.stream_audio_codec || '').toUpperCase()} ${stripChan(s.stream_audio_channel_layout)})`
    : `${decisionLabel(s.stream_audio_decision || s.audio_decision)} (${lang}${(s.stream_audio_codec || s.audio_codec || '').toUpperCase()} ${stripChan(s.stream_audio_channel_layout || s.audio_channel_layout)})`;

  const subtitle = (Number(s.subtitles) && (s.subtitle_codec || s.subtitle_language))
    ? `${decisionLabel(s.subtitle_decision) || 'Direct Play'} (${[s.subtitle_language, (s.subtitle_codec || '').toUpperCase()].filter(Boolean).join(' ')})`
    : 'None';

  const locBits = [`${(s.location || '').toUpperCase()}: ${s.ip_address_public || s.ip_address || ''}`];
  if (Number(s.relayed)) locBits.push('Relayed');
  else if (Number(s.secure)) locBits.push('Secure');

  const remain = (Number(s.duration) || 0) - (Number(s.view_offset) || 0);
  const eta = remain > 0 ? new Date(Date.now() + remain).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  const rows = [
    ['Product', s.product],
    ['Player', s.player],
    ['Quality', `${s.quality_profile || 'Original'} (${mbps(s.stream_bitrate)})`],
    ['Stream', streamLabel],
    ['Container', container],
    ['Video', video],
    ['Audio', audio],
    ['Subtitle', subtitle],
    ['Location', locBits.join(' · ')],
    ['Bandwidth', mbps(s.bandwidth)],
  ];

  const posterThumb = s.grandparent_thumb || s.thumb;
  const body = h('div', {},
    h('div', { class: 'stream-hero' },
      poster(imgUrl(svcKey, posterThumb), s.media_type === 'movie' ? '' : ''),
      h('div', { class: 'stream-hero-main' },
        h('div', { class: 'stream-hero-user' }, `${s.friendly_name || s.user || 'unknown'} · ${s.state || ''}`),
        h('div', { class: 'progress', style: { marginTop: '8px' } }, h('span', { style: { width: pct(Number(s.progress_percent) || 0) } })),
        h('div', { class: 'meta-line', style: { marginTop: '6px' } },
          h('span', {}, `${fmtHms(s.view_offset)} / ${fmtHms(s.duration)}`),
          eta ? h('span', { class: 'dim' }, `ETA ${eta}`) : null,
        ),
      ),
    ),
    h('div', { class: 'stream-detail' }, ...rows.map(([label, val]) => h('div', { class: 'stream-drow' },
      h('span', { class: 'stream-dlabel' }, label),
      h('span', { class: 'stream-dval' }, val || '—'),
    ))),
  );
  openModal({ title: s.full_title || s.title || 'Stream', body, wide: true });
}

function confirmStop(s, tau, reload) {
  const msg = h('input', { class: 'input', value: 'Your stream was stopped by the administrator.' });
  const doStop = async () => {
    const params = { message: msg.value };
    if (s.session_id) params.session_id = s.session_id; else if (s.session_key) params.session_key = s.session_key;
    try {
      await tau.get('terminate_session', params);
      toast('Stream stopped', 'success');
      closeModal();
      reload();
    } catch (e) { toast(e.message, 'error'); }
  };
  openModal({
    title: `Stop stream — ${s.full_title || s.title}`,
    body: h('div', {},
      h('p', { class: 'dim', style: { marginTop: 0 } }, `User: ${s.friendly_name || s.user || 'unknown'} · Player: ${s.player || 'unknown'}`),
      h('div', { class: 'section-title', style: { margin: '0 0 6px' } }, 'Message shown to the user'),
      msg,
      h('p', { class: 'dim', style: { fontSize: '12px', marginBottom: 0 } }, 'Note: terminating streams requires Plex Pass on the server.'),
    ),
    footer: h('div', { style: { display: 'flex', gap: '10px' } },
      h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
      h('button', { class: 'btn danger', onclick: doStop }, '⏹ Stop stream'),
    ),
  });
}

// ---------------- History ----------------
async function tabHistory(root, tau, svcKey) {
  mount(root, skeletonList());
  try {
    const data = await tau.get('get_history', { length: 25, order_column: 'date', order_dir: 'desc' });
    const records = (data && data.data) || [];
    if (!records.length) return mount(root, empty('', 'No history yet'));
    if (effectiveMode(svcKey) === 'hex') {
      mount(root, hive(records.map((r) => historyHex(r, tau, svcKey)), root.clientWidth));
    } else {
      mount(root, h('div', { class: 'list' }, ...records.map((r) => historyRow(r, tau, svcKey))));
    }
  } catch (err) {
    mount(root, empty('', 'Failed to load history', err.message));
  }
}

function historyHex(r, tau, svcKey) {
  const watched = r.watched_status === 1 || Number(r.percent_complete) >= 85;
  const thumb = r.grandparent_thumb || r.thumb;
  return posterHexCard({
    posterUrl: imgUrl(svcKey, thumb),
    title: r.full_title,
    pills: [{ label: watched ? 'Watched' : `${r.percent_complete || 0}%`, cls: watched ? 'ok' : 'muted' }],
    sub: `${r.user || 'unknown'}${r.date ? ` · ${new Date(r.date * 1000).toLocaleDateString()}` : ''}`,
    progress: watched ? null : (Number(r.percent_complete) || null),
    onClick: () => openHistoryDetail(tau, svcKey, r),
  });
}

function historyRow(r, tau, svcKey) {
  const watched = r.watched_status === 1 || Number(r.percent_complete) >= 85;
  const thumb = r.grandparent_thumb || r.thumb;
  return h('div', { class: 'row clickable', onclick: () => openHistoryDetail(tau, svcKey, r) },
    poster(imgUrl(svcKey, thumb), r.media_type === 'movie' ? '' : ''),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, r.full_title),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', {}, `${r.user || 'unknown'}`),
        h('span', {}, r.player || ''),
        h('span', { class: `pill ${watched ? 'ok' : 'muted'}` }, watched ? 'Watched' : `${r.percent_complete || 0}%`),
        r.date ? h('span', {}, new Date(r.date * 1000).toLocaleString()) : null,
      ),
    ),
  );
}

// Parse Tautulli guids (e.g. "imdb://tt123", "tvdb://456", "tmdb://789").
function parseGuids(meta) {
  const out = {};
  const arr = Array.isArray(meta.guids) ? meta.guids : (meta.guid ? [meta.guid] : []);
  for (const g of arr) {
    const m = /^(imdb|tmdb|tvdb):\/\/(.+)$/.exec(String(g));
    if (m) out[m[1]] = m[2].split('?')[0];
  }
  return out;
}

function providerLink(label, href) {
  return h('a', { class: 'btn sm', href, target: '_blank', rel: 'noopener noreferrer', onclick: (e) => e.stopPropagation() }, label);
}

// Open a detail modal for a history item, fetching full metadata from Tautulli.
// TV episodes link out to TVDB; movies link out to IMDb (plus TMDB when present).
async function openHistoryDetail(tau, svcKey, r) {
  const body = h('div', { class: 'hist-detail' }, spinner());
  openModal({ title: r.full_title || 'Details', body });
  try {
    const meta = await tau.get('get_metadata', { rating_key: r.rating_key });
    if (!meta || !meta.rating_key) return mount(body, empty('', 'No metadata available for this item'));
    const isEpisode = meta.media_type === 'episode';
    const ids = parseGuids(meta);
    const thumb = meta.thumb || meta.grandparent_thumb || r.thumb;

    const links = [];
    if (isEpisode) {
      if (ids.tvdb) links.push(providerLink('TVDB episode', `https://www.thetvdb.com/dereferrer/episode/${ids.tvdb}`));
      if (ids.imdb) links.push(providerLink('IMDb', `https://www.imdb.com/title/${ids.imdb}/`));
      if (ids.tmdb) links.push(providerLink('TMDB', `https://www.themoviedb.org/tv/${ids.tmdb}`));
    } else {
      if (ids.imdb) links.push(providerLink('IMDb', `https://www.imdb.com/title/${ids.imdb}/`));
      if (ids.tvdb) links.push(providerLink('TVDB', `https://www.thetvdb.com/dereferrer/movie/${ids.tvdb}`));
      if (ids.tmdb) links.push(providerLink('TMDB', `https://www.themoviedb.org/movie/${ids.tmdb}`));
    }

    const titleMain = isEpisode ? (meta.grandparent_title || meta.title) : (meta.title || r.full_title);
    const sub = isEpisode
      ? `S${String(meta.parent_media_index || 0).padStart(2, '0')}E${String(meta.media_index || 0).padStart(2, '0')}${meta.title ? ` · ${meta.title}` : ''}`
      : (meta.year ? `(${meta.year})` : '');
    const rating = meta.rating || meta.audience_rating;
    const dur = meta.duration ? `${Math.round(Number(meta.duration) / 60000)} min` : '';
    const genres = Array.isArray(meta.genres) ? meta.genres.slice(0, 5).join(', ') : '';
    const directors = Array.isArray(meta.directors) ? meta.directors.slice(0, 3).join(', ') : '';
    const actors = Array.isArray(meta.actors) ? meta.actors.slice(0, 6).join(', ') : '';

    mount(body,
      h('div', { class: 'hist-detail-head' },
        poster(imgUrl(svcKey, thumb), isEpisode ? '' : ''),
        h('div', { class: 'hist-detail-info' },
          h('div', { class: 'row-title', style: { fontSize: '18px' } }, titleMain),
          sub ? h('div', { class: 'dim', style: { marginTop: '2px' } }, sub) : null,
          h('div', { class: 'meta-line', style: { marginTop: '8px' } },
            rating ? h('span', { class: 'pill ok' }, `★ ${rating}`) : null,
            dur ? h('span', {}, dur) : null,
            meta.content_rating ? h('span', { class: 'pill muted' }, meta.content_rating) : null,
            meta.originally_available_at ? h('span', {}, meta.originally_available_at) : null,
          ),
          links.length ? h('div', { class: 'meta-line', style: { marginTop: '10px' } }, ...links) : null,
        ),
      ),
      meta.summary ? h('p', { class: 'hist-summary' }, meta.summary) : null,
      genres ? h('div', { class: 'meta-line hist-meta' }, h('span', { class: 'dim' }, 'Genres: '), h('span', {}, genres)) : null,
      directors ? h('div', { class: 'meta-line hist-meta' }, h('span', { class: 'dim' }, 'Directed by: '), h('span', {}, directors)) : null,
      actors ? h('div', { class: 'meta-line hist-meta' }, h('span', { class: 'dim' }, 'Cast: '), h('span', {}, actors)) : null,
    );
  } catch (e) {
    mount(body, empty('', 'Failed to load metadata', e.message));
  }
}

// ---------------- Statistics ----------------
async function tabStats(root, tau, svcKey) {
  mount(root, skeletonList());
  try {
    const cats = await tau.get('get_home_stats', { time_range: 30, stats_count: 5 });
    if (!Array.isArray(cats) || !cats.length) return mount(root, empty('', 'No statistics available'));
    const withRows = cats.filter((c) => (c.rows || []).length);
    if (effectiveMode(svcKey) === 'list') {
      mount(root,
        h('div', { class: 'dim', style: { marginBottom: '12px' } }, 'Based on the last 30 days'),
        h('div', { class: 'stat-cards' }, ...withRows.map((c) => statCategoryList(c))),
      );
      return;
    }
    // Sideways-scrolling flat-top honeycomb strip (wider hexes for more text room).
    const W = 460, H = 398, GAP = 12;
    const colStep = Math.round(0.75 * W) + GAP, yOff = Math.round(0.5 * H);
    const cards = withRows.map((c, i) => {
      const el = statCategory(c, svcKey);
      el.style.left = `${i * colStep}px`;
      el.style.top = `${(i % 2) * yOff}px`;
      return el;
    });
    const stripW = (withRows.length - 1) * colStep + W + 8;
    const stripH = H + (withRows.length > 1 ? yOff : 0) + 4;
    const strip = h('div', { class: 'stat-strip', style: { width: `${stripW}px`, height: `${stripH}px` } }, ...cards);
    const scroll = h('div', { class: 'stat-scroll' }, strip);
    // Map vertical wheel to horizontal scroll (down → right, up → left).
    scroll.addEventListener('wheel', (e) => {
      if (scroll.scrollWidth <= scroll.clientWidth) return;
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        scroll.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });
    mount(root,
      h('div', { class: 'dim', style: { marginBottom: '12px' } }, 'Based on the last 30 days · scroll to move sideways'),
      scroll,
    );
  } catch (err) {
    mount(root, empty('', 'Failed to load statistics', err.message));
  }
}

function statRows(cat) {
  return (cat.rows || []).map((row, i) => {
    const label = statRowLabel(cat.stat_id, row);
    const value = statRowValue(row);
    return h('div', { class: 'stat-rank-row' },
      h('span', { class: 'stat-rank' }, `${i + 1}`),
      h('span', { class: 'stat-rank-label' }, label),
      h('span', { class: 'dim nowrap' }, value),
    );
  });
}

function statCategory(cat, svcKey) {
  return h('div', { class: 'stat-hexcard' },
    h('div', { class: 'shx-border' }),
    h('div', { class: 'shx-face' },
      h('div', { class: 'shx-inner' },
        h('h3', {}, cat.stat_title || cat.stat_id),
        ...statRows(cat),
      ),
    ),
  );
}

function statCategoryList(cat) {
  return h('div', { class: 'card stat-card' },
    h('h3', { style: { marginTop: '0' } }, cat.stat_title || cat.stat_id),
    ...statRows(cat),
  );
}

function statRowLabel(statId, row) {
  switch (statId) {
    case 'top_libraries': return row.section_name || 'Unknown';
    case 'top_users': return row.friendly_name || row.user || 'Unknown';
    case 'top_platforms': return row.platform_name || row.platform || 'Unknown';
    default: return row.title || row.grandchild_title || row.grandparent_title || 'Unknown';
  }
}

function statRowValue(row) {
  if (row.total_plays !== undefined && row.total_plays !== null && row.total_plays !== '') return `${row.total_plays} plays`;
  if (row.count !== undefined && row.count !== null && row.count !== '') return `${row.count} streams`;
  if (row.total_duration) return secs(row.total_duration);
  return '';
}

function secs(s) {
  const n = Number(s) || 0;
  const hrs = Math.floor(n / 3600);
  const mins = Math.round((n % 3600) / 60);
  return hrs ? `${hrs}h ${mins}m` : `${mins}m`;
}
