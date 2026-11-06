// TRaSH Guides sync planning (pure). Turns a TRaSH quality profile and its
// custom formats into a preview of what would change in Sonarr/Radarr:
// custom formats to create or update, and scores to set on one of your
// quality profiles. Applying lives in trashSync.js.
//
// TRaSH JSON: custom formats have `trash_id`, `trash_scores` (per score set),
// and `fields` as an object; Sonarr/Radarr expect `fields` as [{ name, value }].
// Quality profiles list `formatItems` as { "CF name": trash_id }.

export function toArrFormat(cf) {
  return {
    name: cf.name,
    includeCustomFormatWhenRenaming: !!cf.includeCustomFormatWhenRenaming,
    specifications: (cf.specifications || []).map((s) => ({
      name: s.name, implementation: s.implementation, negate: !!s.negate, required: !!s.required,
      fields: Array.isArray(s.fields) ? s.fields : Object.entries(s.fields || {}).map(([name, value]) => ({ name, value })),
    })),
  };
}

// Comparable form of a format's conditions (order-insensitive).
function specKey(format) {
  return JSON.stringify((format.specifications || []).map((s) => [
    s.name, s.implementation, !!s.negate, !!s.required,
    (Array.isArray(s.fields) ? s.fields : Object.entries(s.fields || {}).map(([name, value]) => ({ name, value })))
      .map((f) => [f.name, f.value]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

export function scoreFor(cf, scoreSet) {
  const s = (cf && cf.trash_scores) || {};
  if (scoreSet && s[scoreSet] !== undefined) return Number(s[scoreSet]);
  return Number(s.default ?? 0);
}

// trashProfile: TRaSH quality profile JSON. cfs: Map(trash_id -> TRaSH CF).
// arrFormats: the instance's custom formats. arrProfile: the quality profile
// to score (or null to leave scores alone).
export function buildSyncPlan({ trashProfile, cfs, arrFormats = [], arrProfile = null }) {
  const byName = new Map((arrFormats || []).map((f) => [String(f.name).toLowerCase(), f]));
  const scoreSet = trashProfile.trash_score_set || '';
  const formats = [];
  const missing = [];
  for (const [name, trashId] of Object.entries(trashProfile.formatItems || {})) {
    const cf = cfs.get(trashId);
    if (!cf) { missing.push({ name, trashId }); continue; }
    const wanted = toArrFormat(cf);
    const existing = byName.get(String(cf.name).toLowerCase());
    const action = !existing ? 'create' : specKey(existing) !== specKey(wanted) || !!existing.includeCustomFormatWhenRenaming !== wanted.includeCustomFormatWhenRenaming ? 'update' : 'same';
    const score = scoreFor(cf, scoreSet);
    const current = arrProfile && existing ? ((arrProfile.formatItems || []).find((fi) => fi.format === existing.id) || {}).score ?? 0 : null;
    formats.push({ trashId, name: cf.name, action, existingId: existing ? existing.id : null, format: wanted, score, currentScore: current });
  }
  const scoreChanges = arrProfile ? formats.filter((f) => f.currentScore === null || f.currentScore !== f.score) : [];
  const thresholds = arrProfile ? ['minFormatScore', 'cutoffFormatScore', 'minUpgradeFormatScore']
    .filter((k) => trashProfile[k] !== undefined && Number(arrProfile[k] ?? 0) !== Number(trashProfile[k]))
    .map((k) => ({ field: k, from: Number(arrProfile[k] ?? 0), to: Number(trashProfile[k]) })) : [];
  return {
    profileName: trashProfile.name,
    scoreSet: scoreSet || 'default',
    formats,
    missing,
    counts: { create: formats.filter((f) => f.action === 'create').length, update: formats.filter((f) => f.action === 'update').length, same: formats.filter((f) => f.action === 'same').length },
    scoreChanges,
    thresholds,
  };
}

// The quality profile body to PUT after formats exist: scores from the plan
// (by format name, since new formats only get ids once created), thresholds
// from TRaSH, every other format left as it was.
export function applyScores(arrProfile, plan, formatIdsByName, { selected } = {}) {
  const next = JSON.parse(JSON.stringify(arrProfile));
  next.formatItems = next.formatItems || [];
  for (const f of plan.formats) {
    if (selected && !selected.has(f.trashId)) continue;
    const id = formatIdsByName.get(String(f.name).toLowerCase());
    if (id == null) continue;
    const fi = next.formatItems.find((x) => x.format === id);
    if (fi) fi.score = f.score;
    else next.formatItems.push({ format: id, name: f.name, score: f.score });
  }
  for (const t of plan.thresholds) next[t.field] = t.to;
  return next;
}
