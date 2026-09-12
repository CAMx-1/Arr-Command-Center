// Tracks failed Seerr requests in localStorage so they can be shown on the
// dashboard and retried. Capped to the most recent 50 entries.
const KEY = 'failed-requests';

export function listFailed() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}

export function addFailed(entry) {
  const list = listFailed();
  // De-dupe by service + payload signature so repeated failures don't stack.
  const sig = JSON.stringify(entry.payload);
  const filtered = list.filter((e) => JSON.stringify(e.payload) !== sig);
  filtered.unshift({ ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: Date.now() });
  localStorage.setItem(KEY, JSON.stringify(filtered.slice(0, 50)));
}

export function removeFailed(id) {
  localStorage.setItem(KEY, JSON.stringify(listFailed().filter((e) => e.id !== id)));
}

export function countFailed() { return listFailed().length; }
