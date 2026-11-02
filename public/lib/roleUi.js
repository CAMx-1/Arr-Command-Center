// Role-aware UI (Sign in with Plex roles). The server enforces every rule;
// this only hides buttons a person couldn't use, so they don't tap something
// that would be refused.
//
//   admin  everything
//   user   no deletes, no settings
//   guest  read-only
//
// app.js sets <html data-role="…"> from /api/config. Without Plex sign-in, and
// in local-only mode, everyone is an admin.

const LEVELS = { guest: ['read'], user: ['read', 'write'], admin: ['read', 'write', 'delete', 'admin'] };

export function currentUiRole(doc = globalThis.document) {
  const r = doc && doc.documentElement && doc.documentElement.dataset.role;
  return LEVELS[r] ? r : 'admin';
}

export function roleAllows(level, role = currentUiRole()) {
  return (LEVELS[role] || LEVELS.admin).includes(level);
}

// Actions that only look things up.
const READ_LABELS = /^(info|details?|seasons?|episodes?|files?|open|view|history|logs?|compare|more|close|cancel|back|copy)\b/i;

// The level an action button needs: an explicit `needs`, else danger = delete,
// a known read label = read, anything else = write.
export function actionLevel(action = {}) {
  if (action.needs) return action.needs;
  if (action.variant === 'danger' || action.danger) return 'delete';
  if (READ_LABELS.test(String(action.label || '').trim())) return 'read';
  return 'write';
}

export function filterActions(actions, role = currentUiRole()) {
  return (actions || []).filter((a) => a && roleAllows(actionLevel(a), role));
}
