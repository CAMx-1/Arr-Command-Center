// Compatibility adapter for the two book managers ArrCC supports.
// Readarr uses the legacy *arr v1 contracts (`records`, command searches),
// while Bindery uses paginated `items` envelopes and resource actions.

export function listItems(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.records)) return data.records;
  return [];
}

async function collectPages(fetchPage, { pageSize = 500, maxItems = 10000 } = {}) {
  const all = [];
  let offset = 0;
  for (;;) {
    const page = await fetchPage(offset, pageSize);
    const items = listItems(page);
    all.push(...items.slice(0, Math.max(0, maxItems - all.length)));
    const total = Number(page && (page.total ?? page.totalRecords));
    if (!items.length || all.length >= maxItems || (Number.isFinite(total) && all.length >= total)) break;
    offset += items.length;
  }
  return all;
}

export function normalizeBinderyQueueItem(item = {}) {
  const percentage = Math.max(0, Math.min(100, Number.parseFloat(item.percentage) || 0));
  const size = Number(item.size) || 0;
  return {
    ...item,
    title: item.title || item.book?.title || `#${item.id}`,
    size,
    sizeleft: item.sizeleft == null ? size * (1 - percentage / 100) : Number(item.sizeleft) || 0,
    timeleft: item.timeleft || item.timeLeft || '',
    author: item.book?.authorName ? { authorName: item.book.authorName } : item.author,
  };
}

export function normalizeBinderyHistoryItem(item = {}) {
  return {
    ...item,
    date: item.date || item.createdAt,
    author: item.author || (item.book?.authorName ? { authorName: item.book.authorName } : undefined),
    sourceTitle: item.sourceTitle || item.book?.title || '',
  };
}

export function createBookServiceClient(api, service) {
  const type = service && service.type;
  const key = service && service.key;
  if (type === 'bindery') {
    const client = api.bindery(key);
    return {
      type,
      library: () => collectPages((offset, limit) => client.get(`author?limit=${limit}&offset=${offset}`)),
      wanted: async (limit = 50) => listItems(await client.get(`wanted/missing?limit=${limit}&offset=0`)),
      queue: async () => listItems(await client.get('queue')).map(normalizeBinderyQueueItem),
      calendar: async (start, end) => collectPages((offset, limit) => client.get(`book?releaseFrom=${encodeURIComponent(start)}&releaseBefore=${encodeURIComponent(end)}&sort=releaseDate&limit=${limit}&offset=${offset}`)),
      history: async (limit = 30) => listItems(await client.get(`history?limit=${limit}&offset=0`)).map(normalizeBinderyHistoryItem),
      search: (bookId) => client.post(`book/${encodeURIComponent(bookId)}/search`),
      removeQueue: (id) => client.del(`queue/${encodeURIComponent(id)}?deleteFiles=false&removeFromClient=true`),
    };
  }
  if (type === 'readarr' || type === 'lidarr') {
    const client = api.arrV1(key);
    const isReadarr = type === 'readarr';
    return {
      type,
      library: async () => listItems(await client.get(isReadarr ? 'author' : 'artist')),
      wanted: async (limit = 50) => listItems(await client.get(`wanted/missing?page=1&pageSize=${limit}&sortDirection=descending`)),
      queue: async () => listItems(await client.get('queue?page=1&pageSize=50')),
      calendar: async (start, end) => listItems(await client.get(`calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`)),
      history: async (limit = 30) => listItems(await client.get(`history?page=1&pageSize=${limit}&sortKey=date&sortDirection=descending`)),
      search: (id) => client.post('command', isReadarr ? { name: 'BookSearch', bookIds: [id] } : { name: 'AlbumSearch', albumIds: [id] }),
      removeQueue: (id) => client.del(`queue/${encodeURIComponent(id)}?removeFromClient=true&blocklist=true`),
    };
  }
  throw new Error(`Unsupported book service type: ${type || 'unknown'}`);
}
