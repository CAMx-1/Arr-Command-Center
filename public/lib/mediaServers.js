const itemsOf = (value) => Array.isArray(value) ? value : (value?.Items || []);

export function mediaImageUrl(serviceKey, item, width = 300) {
  if (!item?.Id || !item.ImageTags?.Primary) return '';
  const query = new URLSearchParams({ maxWidth: String(width), quality: '90', tag: item.ImageTags.Primary });
  return `/api/proxy/${encodeURIComponent(serviceKey)}/Items/${encodeURIComponent(item.Id)}/Images/Primary?${query}`;
}

export function normalizeMediaItem(item = {}, serviceKey = '') {
  return {
    id: item.Id, name: item.Name || 'Untitled', type: item.Type || '', year: item.ProductionYear,
    overview: item.Overview || '', runtimeMinutes: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 600000000) : 0,
    image: mediaImageUrl(serviceKey, item), communityRating: item.CommunityRating,
    seriesName: item.SeriesName || '', seasonName: item.SeasonName || '', index: item.IndexNumber,
  };
}

export function normalizeMediaSession(session = {}, serviceKey = '') {
  const item = session.NowPlayingItem || {};
  const position = Number(session.PlayState?.PositionTicks) || 0;
  const runtime = Number(item.RunTimeTicks) || 0;
  const transcode = session.TranscodingInfo;
  return {
    id: session.Id, user: session.UserName || session.UserId || 'Unknown', client: session.Client || '', device: session.DeviceName || '',
    title: item.SeriesName ? `${item.SeriesName} — ${item.Name || ''}` : item.Name || 'Unknown media',
    state: session.PlayState?.IsPaused ? 'paused' : item.Id ? 'playing' : 'idle',
    progress: runtime > 0 ? Math.round(position / runtime * 100) : 0,
    image: mediaImageUrl(serviceKey, item), transcode: !!transcode,
    videoCodec: transcode?.VideoCodec || item.MediaStreams?.find((stream) => stream.Type === 'Video')?.Codec || '',
    bitrate: Number(transcode?.Bitrate) || 0,
  };
}

export function mediaServerFor(api, service) {
  const client = api.mediaServer(service.key);
  const fields = 'Overview,PrimaryImageAspectRatio,CommunityRating,MediaStreams';
  return {
    type: service.type,
    info: () => client.get('System/Info'),
    libraries: async () => (await client.get('Library/VirtualFolders') || []).map((library) => ({ id: library.ItemId, name: library.Name, type: library.CollectionType || '', locations: library.Locations || [] })),
    items: async (parentId) => itemsOf(await client.get(`Items?ParentId=${encodeURIComponent(parentId)}&Recursive=true&Limit=100&SortBy=SortName&Fields=${encodeURIComponent(fields)}`)).map((item) => normalizeMediaItem(item, service.key)),
    latest: async () => itemsOf(await client.get(`Items/Latest?Limit=60&IncludeItemTypes=Movie,Series,Episode&Fields=${encodeURIComponent(fields)}`)).map((item) => normalizeMediaItem(item, service.key)),
    sessions: async () => (await client.get('Sessions') || []).filter((session) => session.NowPlayingItem).map((session) => normalizeMediaSession(session, service.key)),
    users: async () => (await client.get('Users') || []).map((user) => ({ id: user.Id, name: user.Name || 'User', admin: !!user.Policy?.IsAdministrator, disabled: !!user.Policy?.IsDisabled, lastLogin: user.LastLoginDate, image: user.PrimaryImageTag ? `/api/proxy/${encodeURIComponent(service.key)}/Users/${encodeURIComponent(user.Id)}/Images/Primary?tag=${encodeURIComponent(user.PrimaryImageTag)}&maxWidth=160` : '' })),
  };
}
