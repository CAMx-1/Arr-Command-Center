// Playback decision labels for "now playing" pills.
//
// Tautulli's transcode_decision is "direct play", "copy" (Direct Stream: the
// container is remuxed but audio/video are untouched) or "transcode".
// Jellyfin/Emby report PlayState.PlayMethod as DirectPlay, DirectStream or
// Transcode. Jellyfin also fills TranscodingInfo for Direct Stream, so its
// presence alone does not mean a transcode.

const TRANSCODE = Object.freeze({ label: 'Transcode', cls: 'warn', transcode: true });
const DIRECT_STREAM = Object.freeze({ label: 'Direct Stream', cls: 'ok', transcode: false });
const DIRECT_PLAY = Object.freeze({ label: 'Direct Play', cls: 'ok', transcode: false });

export function tautulliDecision(value) {
  const x = String(value || '').toLowerCase().replace(/[\s_-]+/g, ' ').trim();
  if (x === 'transcode') return TRANSCODE;
  if (x === 'copy' || x === 'direct stream') return DIRECT_STREAM;
  return DIRECT_PLAY;
}

export function mediaPlayMethod(session = {}) {
  const method = String((session.PlayState && session.PlayState.PlayMethod) || '').toLowerCase();
  if (method === 'transcode') return TRANSCODE;
  if (method === 'directstream') return DIRECT_STREAM;
  if (method === 'directplay') return DIRECT_PLAY;
  // Older servers without PlayMethod: infer from TranscodingInfo.
  const info = session.TranscodingInfo;
  if (!info) return DIRECT_PLAY;
  if (info.IsVideoDirect && info.IsAudioDirect) return DIRECT_STREAM;
  return TRANSCODE;
}
