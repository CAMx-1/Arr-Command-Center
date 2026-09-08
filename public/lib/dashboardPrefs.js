export const DEFAULT_WIDGETS = [
  { id: 'services', label: 'Services', visible: true, size: 'full' },
  { id: 'activity', label: 'Activity', visible: true, size: 'full' },
  { id: 'streams', label: 'Tautulli Active Streams', visible: true, size: 'full' },
  { id: 'seerr', label: 'Seerr Requests & Issues', visible: true, size: 'full' },
  { id: 'upcoming', label: 'Upcoming', visible: true, size: 'full' },
  { id: 'links', label: 'Quick Links', visible: true, size: 'full' },
  { id: 'status', label: 'Status', visible: false, size: 'full' },
  { id: 'inbox', label: 'Action Inbox', visible: false, size: 'full' },
];
const LEGACY_DEFAULT_WIDGETS = [
  { id: 'status', visible: true, size: 'full' },
  { id: 'inbox', visible: true, size: 'wide' },
  { id: 'services', visible: true, size: 'full' },
  { id: 'activity', visible: true, size: 'wide' },
  { id: 'upcoming', visible: true, size: 'medium' },
  { id: 'links', visible: true, size: 'medium' },
];
const V2_DEFAULT_WIDGETS = [
  { id: 'services', visible: true, size: 'full' },
  { id: 'activity', visible: true, size: 'full' },
  { id: 'upcoming', visible: true, size: 'full' },
  { id: 'links', visible: true, size: 'full' },
  { id: 'status', visible: false, size: 'full' },
  { id: 'inbox', visible: false, size: 'full' },
];
export const DASHBOARD_PREFS_VERSION = 3;
let dashboardScope = 'local';
const storageKey = () => `acc:dashboards:${dashboardScope}`;
export function setDashboardScope(user) {
  const value = user && (user.id || user.uuid || user.username || user.email || user.title || user.displayName);
  dashboardScope = String(value || 'local').replace(/[^a-z0-9@._-]/gi, '_').slice(0, 80);
}
const sizes = new Set(['small', 'medium', 'wide', 'full', 'hex']);
const storageFor = (storage) => storage || globalThis.localStorage;

function normalizeWidgets(widgets) {
  const hasSuppliedLayout = Array.isArray(widgets);
  const supplied = new Map((hasSuppliedLayout ? widgets : []).map((widget) => [widget.id, widget]));
  return DEFAULT_WIDGETS.map((base) => {
    const value = supplied.get(base.id) || {};
    const addedWidgetDefault = hasSuppliedLayout && !supplied.has(base.id) && base.id === 'seerr' ? false : base.visible;
    return { ...base, visible: value.visible === undefined ? addedWidgetDefault : value.visible !== false, size: sizes.has(value.size) ? value.size : base.size };
  }).sort((a, b) => {
    const order = Array.isArray(widgets) ? widgets.map((widget) => widget.id) : [];
    const ai = order.indexOf(a.id); const bi = order.indexOf(b.id);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  });
}

function isUntouchedLegacyDefault(widgets) {
  if (!Array.isArray(widgets) || widgets.length !== LEGACY_DEFAULT_WIDGETS.length) return false;
  return LEGACY_DEFAULT_WIDGETS.every((expected, index) => {
    const value = widgets[index] || {};
    return value.id === expected.id && value.visible !== false && value.size === expected.size;
  });
}

function isUntouchedV2Default(widgets) {
  if (!Array.isArray(widgets) || widgets.length !== V2_DEFAULT_WIDGETS.length) return false;
  return V2_DEFAULT_WIDGETS.every((expected, index) => {
    const value = widgets[index] || {};
    return value.id === expected.id && (value.visible !== false) === expected.visible && value.size === expected.size;
  });
}

export function defaultDashboardState() {
  return { version: DASHBOARD_PREFS_VERSION, activeId: 'default', dashboards: [{ id: 'default', name: 'Overview', widgets: normalizeWidgets() }] };
}

export function loadDashboards(storage) {
  try {
    const parsed = JSON.parse(storageFor(storage).getItem(storageKey()) || 'null');
    if (!parsed || !Array.isArray(parsed.dashboards) || !parsed.dashboards.length) return defaultDashboardState();
    const dashboards = parsed.dashboards.map((dashboard) => {
      const resetBuiltIn = dashboard.id === 'default'
        && Number(parsed.version || 1) < DASHBOARD_PREFS_VERSION
        && (isUntouchedLegacyDefault(dashboard.widgets) || isUntouchedV2Default(dashboard.widgets));
      return {
        ...dashboard,
        name: String(dashboard.name || 'Dashboard').slice(0, 60),
        widgets: normalizeWidgets(resetBuiltIn ? undefined : dashboard.widgets),
      };
    });
    return { version: DASHBOARD_PREFS_VERSION, activeId: dashboards.some((d) => d.id === parsed.activeId) ? parsed.activeId : dashboards[0].id, dashboards };
  } catch { return defaultDashboardState(); }
}

export function saveDashboards(state, storage) {
  const next = { ...state, version: DASHBOARD_PREFS_VERSION };
  storageFor(storage).setItem(storageKey(), JSON.stringify(next));
  return next;
}

export function activeDashboard(state) { return state.dashboards.find((d) => d.id === state.activeId) || state.dashboards[0]; }

export function createDashboard(state, name, widgets) {
  const normalized = String(name || '').trim().slice(0, 60);
  if (!normalized) throw new Error('Dashboard name is required');
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  return { ...state, activeId: id, dashboards: [...state.dashboards, { id, name: normalized, widgets: normalizeWidgets(widgets) }] };
}

export function removeDashboard(state, id) {
  if (state.dashboards.length <= 1) return state;
  const dashboards = state.dashboards.filter((d) => d.id !== id);
  return { ...state, activeId: state.activeId === id ? dashboards[0].id : state.activeId, dashboards };
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

export function resetBuiltInDashboard(state) {
  const hasDefault = state.dashboards.some((dashboard) => dashboard.id === 'default');
  const dashboard = { id: 'default', name: 'Overview', widgets: normalizeWidgets() };
  return {
    ...state,
    activeId: 'default',
    dashboards: hasDefault
      ? state.dashboards.map((entry) => entry.id === 'default' ? dashboard : entry)
      : [dashboard, ...state.dashboards],
  };
}
