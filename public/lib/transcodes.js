// Titles that keep transcoding in Plex, from Tautulli history, with the
// reason taken from a sample play's stream data and what to do about it.

const lc = (v) => String(v || '').toLowerCase();
const isTranscode = (row) => lc(row.transcode_decision) === 'transcode';
const CODEC = { hevc: 'HEVC (H.265)', h265: 'HEVC (H.265)', av1: 'AV1', vp9: 'VP9', h264: 'H.264', mpeg2video: 'MPEG-2', vc1: 'VC-1', truehd: 'Dolby TrueHD', dca: 'DTS', dts: 'DTS', 'dts-hd ma': 'DTS-HD MA', flac: 'FLAC', pgs: 'PGS (image)', vobsub: 'VobSub (image)', ass: 'ASS', ssa: 'SSA' };
const name = (c) => CODEC[lc(c)] || String(c || '').toUpperCase() || 'this format';

export function groupHistory(rows, { minPlays = 2, minShare = 0.6 } = {}) {
  const by = new Map();
  for (const r of rows || []) {
    const show = lc(r.media_type) === 'episode';
    const key = show ? `show:${r.grandparent_rating_key || r.grandparent_title}` : `movie:${r.rating_key || r.full_title}`;
    const g = by.get(key) || { key, kind: show ? 'show' : 'movie', title: show ? (r.grandparent_title || String(r.full_title || '').split(' - ')[0]) : (r.title || r.full_title), year: show ? null : r.year, ratingKey: show ? r.grandparent_rating_key : r.rating_key, plays: 0, transcodes: 0, rowIds: [], players: new Set() };
    g.plays += 1;
    if (isTranscode(r)) { g.transcodes += 1; if (r.id != null) g.rowIds.push(r.id); if (r.player) g.players.add(r.player); }
    by.set(key, g);
  }
  return [...by.values()]
    .filter((g) => g.plays >= minPlays && g.transcodes / g.plays >= minShare)
    .map((g) => ({ ...g, share: Math.round((g.transcodes / g.plays) * 100), players: [...g.players] }))
    .sort((a, b) => b.transcodes - a.transcodes || b.share - a.share || a.title.localeCompare(b.title));
}

// Why one play transcoded, from get_stream_data. Most expensive cause first.
export function reasonsFor(sd = {}) {
  const out = [];
  const player = sd.player || 'the player';
  if (lc(sd.subtitle_decision) === 'burn') out.push({ id: 'subs', text: `Subtitles are burned into the picture (${name(sd.subtitle_codec)} subtitles)`, fix: 'Get text subtitles (SRT) with Bazarr, or pick a release with SRT subtitles. Turning subtitles off also avoids it.' });
  if (lc(sd.video_decision) === 'transcode') {
    if (lc(sd.video_codec) !== lc(sd.stream_video_codec)) out.push({ id: 'codec', text: `${player} can’t play ${name(sd.video_codec)} video`, fix: `Replace with an H.264 release, or use a Plex app on that device that supports ${name(sd.video_codec)}.` });
    else if (Number(sd.stream_bitrate) && Number(sd.bitrate) > Number(sd.stream_bitrate)) out.push({ id: 'bitrate', text: `File is ${Math.round(sd.bitrate / 1000)} Mbps but ${player} is set to ${sd.quality_profile && sd.quality_profile !== 'Original' ? sd.quality_profile : `${Math.round(sd.stream_bitrate / 1000)} Mbps`}`, fix: 'Raise the quality setting in that Plex app (Remote/Internet streaming), or get a smaller release.' });
    else if (!out.some((r) => r.id === 'subs')) out.push({ id: 'video', text: 'Video was converted', fix: 'Check the play in Tautulli for details.' });
  }
  if (lc(sd.audio_decision) === 'transcode') out.push({ id: 'audio', text: `${player} can’t play ${name(sd.audio_codec)} audio, so it’s converted`, fix: 'Usually cheap. A release with AC3/EAC3 audio avoids it; so does audio passthrough on the device.', light: true });
  if (!out.length && lc(sd.container) !== lc(sd.stream_container)) out.push({ id: 'container', text: `Only the container changes (${sd.container} → ${sd.stream_container})`, fix: 'Cheap; nothing to fix.', light: true });
  return out;
}

export async function loadTranscodes(tau, { days = 30, maxTitles = 25, sample = 3 } = {}) {
  const after = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const hist = await tau.get('get_history', { length: 5000, after });
  const groups = groupHistory((hist && hist.data) || []).slice(0, maxTitles);
  await Promise.all(groups.map(async (g) => {
    const seen = new Map();
    for (const id of g.rowIds.slice(0, sample)) {
      const sd = await tau.get('get_stream_data', { row_id: id }).catch(() => null);
      for (const r of reasonsFor(sd || {})) if (!seen.has(r.id)) seen.set(r.id, r);
    }
    g.reasons = [...seen.values()];
  }));
  return { groups, plays: ((hist && hist.data) || []).length, days };
}

// Find the title in Sonarr/Radarr (by title + year for movies).
export function matchLibrary(g, libs) {
  const norm = (s) => lc(s).replace(/[^a-z0-9]/g, '');
  for (const l of libs) {
    if ((g.kind === 'movie') !== (l.kind === 'movie')) continue;
    const hit = (l.items || []).find((it) => norm(it.title) === norm(g.title) && (g.kind !== 'movie' || !g.year || Number(it.year) === Number(g.year)));
    if (hit) return { ...l, item: hit };
  }
  return null;
}
