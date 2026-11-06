// Compare settings between two instances of the same app (e.g. Radarr and
// Radarr 4K). Pure: takes the settings each instance returned and lists what
// differs, section by section. Ids differ between instances, so everything
// is matched by name.

const norm = (v) => (v === undefined ? null : v);
const lower = (s) => String(s || '').toLowerCase();

// Field-by-field differences of two flat objects, ignoring ids and noise.
export function diffFields(a, b, { ignore = ['id'] } = {}) {
  const keys = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].filter((k) => !ignore.includes(k)).sort();
  return keys.filter((k) => JSON.stringify(norm((a || {})[k])) !== JSON.stringify(norm((b || {})[k])))
    .filter((k) => typeof (a || {})[k] !== 'object' || (a || {})[k] === null)
    .map((k) => ({ field: k, a: norm((a || {})[k]), b: norm((b || {})[k]) }));
}

const formatKey = (f) => JSON.stringify([!!f.includeCustomFormatWhenRenaming, (f.specifications || []).map((s) => [s.name, s.implementation, !!s.negate, !!s.required, (s.fields || []).map((x) => [x.name, x.value])]).sort((x, y) => String(x[0]).localeCompare(String(y[0])))]);

function qualityList(p) {
  return (p.items || []).slice().reverse().map((it) => ({ name: it.items && it.items.length ? it.name : it.quality && it.quality.name, allowed: !!it.allowed }));
}

// a, b: { qualityprofile, customformat, naming, mediamanagement, delayprofile, releaseprofile, tag }
export function compareInstances(a, b) {
  const sections = [];

  // Custom formats: only in one, or same name with different rules.
  const fa = new Map((a.customformat || []).map((f) => [lower(f.name), f]));
  const fb = new Map((b.customformat || []).map((f) => [lower(f.name), f]));
  const formats = [];
  for (const [k, f] of fa) if (!fb.has(k)) formats.push({ name: f.name, kind: 'only-a' });
  for (const [k, f] of fb) if (!fa.has(k)) formats.push({ name: f.name, kind: 'only-b' });
  for (const [k, f] of fa) if (fb.has(k) && formatKey(f) !== formatKey(fb.get(k))) formats.push({ name: f.name, kind: 'differs' });
  sections.push({ id: 'formats', title: 'Custom formats', items: formats.sort((x, y) => x.name.localeCompare(y.name)) });

  // Quality profiles: presence, then settings, qualities and scores by format name.
  const pa = new Map((a.qualityprofile || []).map((p) => [lower(p.name), p]));
  const pb = new Map((b.qualityprofile || []).map((p) => [lower(p.name), p]));
  const fname = (inst) => new Map((inst.customformat || []).map((f) => [f.id, f.name]));
  const na = fname(a); const nb = fname(b);
  const profiles = [];
  for (const [k, p] of pa) if (!pb.has(k)) profiles.push({ name: p.name, kind: 'only-a' });
  for (const [k, p] of pb) if (!pa.has(k)) profiles.push({ name: p.name, kind: 'only-b' });
  for (const [k, p] of pa) {
    const q = pb.get(k);
    if (!q) continue;
    const changes = [];
    for (const d of diffFields(p, q, { ignore: ['id', 'name', 'items', 'formatItems', 'cutoff', 'language'] })) changes.push(d);
    const cutName = (x) => { const it = (x.items || []).find((i) => (i.items && i.items.length ? i.id : i.quality && i.quality.id) === x.cutoff); return it ? (it.items && it.items.length ? it.name : it.quality.name) : x.cutoff; };
    if (cutName(p) !== cutName(q)) changes.push({ field: 'cutoff', a: cutName(p), b: cutName(q) });
    const qa = qualityList(p); const qb = qualityList(q);
    if (JSON.stringify(qa) !== JSON.stringify(qb)) changes.push({ field: 'qualities', a: qa.filter((x) => x.allowed).map((x) => x.name).join(', '), b: qb.filter((x) => x.allowed).map((x) => x.name).join(', ') });
    const sa = new Map((p.formatItems || []).filter((x) => x.score).map((x) => [lower(x.name || na.get(x.format)), x.score]));
    const sb = new Map((q.formatItems || []).filter((x) => x.score).map((x) => [lower(x.name || nb.get(x.format)), x.score]));
    for (const n of [...new Set([...sa.keys(), ...sb.keys()])].sort()) if ((sa.get(n) || 0) !== (sb.get(n) || 0)) changes.push({ field: `score: ${n}`, a: sa.get(n) || 0, b: sb.get(n) || 0 });
    if (changes.length) profiles.push({ name: p.name, kind: 'differs', changes });
  }
  sections.push({ id: 'profiles', title: 'Quality profiles', items: profiles });

  sections.push({ id: 'naming', title: 'File naming', items: diffFields(a.naming, b.naming).map((d) => ({ name: d.field, kind: 'differs', changes: [d] })) });
  sections.push({ id: 'media', title: 'Media management', items: diffFields(a.mediamanagement, b.mediamanagement).map((d) => ({ name: d.field, kind: 'differs', changes: [d] })) });

  const tags = (inst) => new Map((inst.tag || []).map((t) => [t.id, t.label]));
  const ta = tags(a); const tb = tags(b);
  const delayKey = (d, t) => JSON.stringify([d.preferredProtocol, d.usenetDelay, d.torrentDelay, !!d.enableUsenet, !!d.enableTorrent, !!d.bypassIfHighestQuality, (d.tags || []).map((x) => t.get(x)).sort()]);
  const da = new Set((a.delayprofile || []).map((d) => delayKey(d, ta)));
  const db = new Set((b.delayprofile || []).map((d) => delayKey(d, tb)));
  const delays = [];
  for (const d of a.delayprofile || []) if (!db.has(delayKey(d, ta))) delays.push({ name: describeDelay(d, ta), kind: 'only-a' });
  for (const d of b.delayprofile || []) if (!da.has(delayKey(d, tb))) delays.push({ name: describeDelay(d, tb), kind: 'only-b' });
  sections.push({ id: 'delay', title: 'Delay profiles', items: delays });

  const relKey = (r, t) => JSON.stringify([r.name || '', [...(r.required || [])].sort(), [...(r.ignored || [])].sort(), (r.tags || []).map((x) => t.get(x)).sort(), r.enabled !== false]);
  const ra = new Set((a.releaseprofile || []).map((r) => relKey(r, ta)));
  const rb = new Set((b.releaseprofile || []).map((r) => relKey(r, tb)));
  const rels = [];
  for (const r of a.releaseprofile || []) if (!rb.has(relKey(r, ta))) rels.push({ name: r.name || describeRelease(r), kind: 'only-a' });
  for (const r of b.releaseprofile || []) if (!ra.has(relKey(r, tb))) rels.push({ name: r.name || describeRelease(r), kind: 'only-b' });
  sections.push({ id: 'release', title: 'Release profiles', items: rels });

  return { sections, total: sections.reduce((n, s) => n + s.items.length, 0) };
}

export function describeDelay(d, tags = new Map()) {
  const t = (d.tags || []).map((x) => tags.get(x) || x);
  return `${d.preferredProtocol || 'usenet'} first · usenet ${d.usenetDelay || 0} min · torrent ${d.torrentDelay || 0} min${t.length ? ` · tags ${t.join(', ')}` : ' · default'}`;
}
export function describeRelease(r) {
  const req = (r.required || []).length; const ign = (r.ignored || []).length;
  return `${req} must contain, ${ign} must not contain`;
}

// What compareInstances needs, fetched from one instance.
export const COMPARE_ENDPOINTS = ['qualityprofile', 'customformat', 'config/naming', 'config/mediamanagement', 'delayprofile', 'releaseprofile', 'tag'];
export async function loadSettings(arr) {
  const vals = await Promise.all(COMPARE_ENDPOINTS.map((p) => arr.get(p).catch(() => null)));
  const o = {};
  COMPARE_ENDPOINTS.forEach((p, i) => { o[p.replace('config/', '')] = vals[i]; });
  return o;
}
