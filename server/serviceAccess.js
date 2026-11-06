// Which services each role can see. Admins always see everything. For user
// and guest, null means "all services"; a list limits them to those keys.
// Hidden services are left out of the config, status and activity the
// browser gets, and every proxied or live request to them is refused.
export const NS = 'roleServices';
const ROLES = ['user', 'guest'];

// Push notifications follow the same lists. Only a subscriber whose role is
// known and who can't see one of the services is skipped; anyone else gets
// it as before. keys: the services a notification is about.
export function pushFilter({ enabled, roleOf, allowed, known = () => true }) {
  return (keys) => (sub) => {
    if (!enabled() || !sub || !sub.user) return true;
    const role = roleOf(sub.user, sub.email);
    if (!role || role === 'admin') return true;
    return keys.filter(known).every((k) => allowed(role, k));
  };
}

export function createServiceAccess(store) {
  const read = () => ({ user: null, guest: null, ...(store.get(NS, {}) || {}) });
  const allowed = (role, key) => {
    if (!role || role === 'admin') return true;
    const list = read()[role];
    return !Array.isArray(list) || list.includes(key);
  };
  const filterMap = (role, obj) => (role === 'admin' || !role ? obj : Object.fromEntries(Object.entries(obj || {}).filter(([k]) => allowed(role, k))));
  function save(input, knownKeys) {
    const cur = read();
    for (const r of ROLES) {
      if (!(r in (input || {}))) continue;
      const v = input[r];
      if (v === null) { cur[r] = null; continue; }
      if (!Array.isArray(v)) return { error: `${r} must be a list of services or null` };
      cur[r] = [...new Set(v.map(String))].filter((k) => knownKeys.includes(k));
    }
    store.set(NS, cur);
    return { settings: cur };
  }
  return { read, allowed, filterMap, save };
}
