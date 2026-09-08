export const DEFAULT_WIDGETS = [
  { id: 'status', label: 'Status', visible: true, size: 'full' },
  { id: 'inbox', label: 'Action Inbox', visible: true, size: 'wide' },
  { id: 'services', label: 'Services', visible: true, size: 'full' },
  { id: 'activity', label: 'Activity Timeline', visible: true, size: 'wide' },
  { id: 'upcoming', label: 'Upcoming', visible: true, size: 'medium' },
  { id: 'links', label: 'Quick Links', visible: true, size: 'medium' },
];
let dashboardScope = 'local';
const storageKey = () => `acc:dashboards:${dashboardScope}`;
export function setDashboardScope(user) {
  const value = user && (user.id || user.uuid || user.username || user.email || user.title || user.displayName);
  dashboardScope = String(value || 'local').replace(/[^a-z0-9@._-]/gi, '_').slice(0, 80);
}
const sizes = new Set(['small', 'medium', 'wide', 'full']);
const storageFor = (storage) => storage || globalThis.localStorage;

function normalizeWidgets(widgets) {
  const supplied = new Map((Array.isArray(widgets) ? widgets : []).map((widget) => [widget.id, widget]));
  return DEFAULT_WIDGETS.map((base) => {
    const value = supplied.get(base.id) || {};
    return { ...base, visible: value.visible !== false, size: sizes.has(value.size) ? value.size : base.size };
  }).sort((a, b) => {
    const order = Array.isArray(widgets) ? widgets.map((widget) => widget.id) : [];
    const ai = order.indexOf(a.id); const bi = order.indexOf(b.id);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  });
}

export function defaultDashboardState() {
  return { activeId: 'default', dashboards: [{ id: 'default', name: 'Overview', widgets: normalizeWidgets() }] };
}

export function loadDashboards(storage) {
  try {
    const parsed = JSON.parse(storageFor(storage).getItem(storageKey()) || 'null');
    if (!parsed || !Array.isArray(parsed.dashboards) || !parsed.dashboards.length) return defaultDashboardState();
    const dashboards = parsed.dashboards.map((dashboard) => ({ ...dashboard, name: String(dashboard.name || 'Dashboard').slice(0, 60), widgets: normalizeWidgets(dashboard.widgets) }));
    return { activeId: dashboards.some((d) => d.id === parsed.activeId) ? parsed.activeId : dashboards[0].id, dashboards };
  } catch { return defaultDashboardState(); }
}

export function saveDashboards(state, storage) {
  storageFor(storage).setItem(storageKey(), JSON.stringify(state));
  return state;
}

export function activeDashboard(state) { return state.dashboards.find((d) => d.id === state.activeId) || state.dashboards[0]; }

export function createDashboard(state, name) {
  const normalized = String(name || '').trim().slice(0, 60);
  if (!normalized) throw new Error('Dashboard name is required');
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  return { activeId: id, dashboards: [...state.dashboards, { id, name: normalized, widgets: normalizeWidgets() }] };
}

export function removeDashboard(state, id) {
  if (state.dashboards.length <= 1) return state;
  const dashboards = state.dashboards.filter((d) => d.id !== id);
  return { activeId: state.activeId === id ? dashboards[0].id : state.activeId, dashboards };
}

export function updateDashboard(state, id, patch) {
  return { ...state, dashboards: state.dashboards.map((dashboard) => dashboard.id === id ? { ...dashboard, ...patch, widgets: patch.widgets ? normalizeWidgets(patch.widgets) : dashboard.widgets } : dashboard) };
}

export function moveWidget(widgets, id, delta) {
  const next = widgets.map((widget) => ({ ...widget }));
  const from = next.findIndex((widget) => widget.id === id);
  const to = Math.max(0, Math.min(next.length - 1, from + delta));
  if (from < 0 || from === to) return next;
  const [entry] = next.splice(from, 1); next.splice(to, 0, entry); return next;
}
