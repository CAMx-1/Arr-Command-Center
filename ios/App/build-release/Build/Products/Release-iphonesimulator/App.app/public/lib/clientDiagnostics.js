const LOG_KEY = 'acc:client-log:v1';
const MAX_ENTRIES = 100;
const MAX_TEXT = 700;

function storageFor(storage) { return storage || globalThis.localStorage; }

export function redactDiagnostic(value) {
  let text = String(value ?? '');
  text = text.replace(/([?&](?:api_?key|apikey|token|access_token|code|secret|password|key)=)[^&#\s]*/gi, '$1[REDACTED]');
  text = text.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]');
  text = text.replace(/(CF-Access-Client-(?:Id|Secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
  return text.slice(0, MAX_TEXT);
}

export function readClientLog(storage) {
  try {
    const parsed = JSON.parse(storageFor(storage)?.getItem(LOG_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(-MAX_ENTRIES) : [];
  } catch { return []; }
}

export function recordClientEvent(level, message, detail, storage) {
  const entry = {
    at: Date.now(),
    level: ['info', 'warn', 'error'].includes(level) ? level : 'info',
    message: redactDiagnostic(message),
    ...(detail == null ? {} : { detail: redactDiagnostic(typeof detail === 'string' ? detail : JSON.stringify(detail)) }),
  };
  const entries = [...readClientLog(storage), entry].slice(-MAX_ENTRIES);
  try { storageFor(storage)?.setItem(LOG_KEY, JSON.stringify(entries)); } catch { /* storage unavailable */ }
  return entry;
}

export function clearClientLog(storage) {
  try { storageFor(storage)?.removeItem(LOG_KEY); } catch { /* ignore */ }
}

let installed = false;
export function installClientDiagnostics() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  recordClientEvent('info', 'App boot', { origin: location.origin, online: navigator.onLine });
  window.addEventListener('error', (event) => {
    recordClientEvent('error', event.message || 'Unhandled window error', `${event.filename || ''}:${event.lineno || 0}:${event.colno || 0}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    recordClientEvent('error', 'Unhandled promise rejection', reason?.stack || reason?.message || reason);
  });
  window.addEventListener('offline', () => recordClientEvent('warn', 'Device went offline'));
  window.addEventListener('online', () => recordClientEvent('info', 'Device came online'));
  window.addEventListener('app-error', (event) => recordClientEvent('error', event.detail?.message || 'Application error'));
}

export function diagnosticReport({ app = {}, serverOrigin = '', serverBuild = '', services = [] } = {}) {
  const safeServices = (services || []).map((s) => ({ key: s.key, type: s.type, label: s.label, configured: !!s.configured }));
  return {
    generatedAt: new Date().toISOString(),
    app: { name: app.name, id: app.id, version: app.version, build: app.build, native: !!app.native },
    runtime: {
      serverOrigin: (() => { try { return new URL(serverOrigin).origin; } catch { return ''; } })(),
      serverBuild: redactDiagnostic(serverBuild),
      platform: navigator.platform || '',
      userAgent: redactDiagnostic(navigator.userAgent || ''),
      online: navigator.onLine,
      route: location.hash || '#/home',
    },
    services: safeServices,
    recentEvents: readClientLog().slice(-40),
  };
}

export async function copyDiagnosticReport(data) {
  const text = JSON.stringify(data, null, 2);
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return text; }
  const area = document.createElement('textarea');
  area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
  document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
  return text;
}
