// Pure helpers for the Sonarr/Radarr System tab: quality profile summaries,
// custom format specification labels and tag usage.

// Profile items are listed worst-first by the API; groups contain items.
export function profileSummary(profile = {}, formats = []) {
  const byId = new Map();
  const qualities = [];
  for (const item of profile.items || []) {
    if (item.items && item.items.length) {
      const allowed = item.items.filter((q) => q.allowed !== false && q.quality);
      if (item.allowed !== false && allowed.length) qualities.push(item.name || allowed.map((q) => q.quality.name).join('/'));
      for (const q of item.items) if (q.quality) byId.set(q.quality.id, q.quality.name);
      if (item.id != null) byId.set(item.id, item.name);
    } else if (item.quality) {
      byId.set(item.quality.id, item.quality.name);
      if (item.allowed) qualities.push(item.quality.name);
    }
  }
  const formatName = new Map((formats || []).map((f) => [f.id, f.name]));
  const scored = (profile.formatItems || [])
    .filter((f) => Number(f.score))
    .map((f) => ({ name: f.name || formatName.get(f.format) || `Format ${f.format}`, score: Number(f.score) }))
    .sort((a, b) => b.score - a.score);
  return {
    name: profile.name || 'Profile',
    qualities: qualities.reverse(),
    cutoff: byId.get(profile.cutoff) || '',
    upgradeAllowed: !!profile.upgradeAllowed,
    minFormatScore: Number(profile.minFormatScore) || 0,
    cutoffFormatScore: Number(profile.cutoffFormatScore) || 0,
    scored,
  };
}

const SPEC_LABELS = {
  ReleaseTitleSpecification: 'Title', ReleaseGroupSpecification: 'Group', SourceSpecification: 'Source',
  ResolutionSpecification: 'Resolution', LanguageSpecification: 'Language', IndexerFlagSpecification: 'Indexer flag',
  SizeSpecification: 'Size', QualityModifierSpecification: 'Modifier', ReleaseTypeSpecification: 'Release type',
  EditionSpecification: 'Edition', YearSpecification: 'Year',
};

export function formatSpecSummary(spec = {}) {
  const kind = SPEC_LABELS[spec.implementation] || String(spec.implementation || 'Spec').replace(/Specification$/, '');
  const value = (spec.fields || []).find((f) => f && f.name === 'value');
  const label = `${spec.negate ? 'not ' : ''}${kind}: ${spec.name || ''}${spec.required ? ' (required)' : ''}`.trim();
  return { label, detail: value && value.value != null ? String(value.value) : '' };
}

// tag/detail rows carry the ids of everything using the tag.
const USAGE_FIELDS = [
  ['seriesIds', 'series', 'series'], ['movieIds', 'movie', 'movies'], ['indexerIds', 'indexer', 'indexers'],
  ['downloadClientIds', 'download client', 'download clients'], ['notificationIds', 'connection', 'connections'],
  ['importListIds', 'import list', 'import lists'], ['delayProfileIds', 'delay profile', 'delay profiles'],
  ['restrictionIds', 'release profile', 'release profiles'], ['releaseProfileIds', 'release profile', 'release profiles'],
  ['autoTagIds', 'auto tag', 'auto tags'],
];
export function tagUsage(tags = []) {
  return (tags || []).map((t) => {
    const parts = [];
    let total = 0;
    for (const [field, one, many] of USAGE_FIELDS) {
      const n = Array.isArray(t[field]) ? t[field].length : 0;
      if (n) { total += n; parts.push(`${n} ${n === 1 ? one : many}`); }
    }
    return { id: t.id, label: t.label, total, summary: parts.join(', ') };
  }).sort((a, b) => a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------- editing
// Rows the editor shows, best first: one per top-level item (a quality or a
// group), with the id Sonarr/Radarr use for the cutoff.
export function profileRows(profile = {}) {
  return (profile.items || []).map((item, index) => {
    const isGroup = !!(item.items && item.items.length);
    return {
      index,
      cutoffId: isGroup ? item.id : item.quality && item.quality.id,
      name: isGroup ? (item.name || item.items.map((q) => q.quality && q.quality.name).join('/')) : (item.quality && item.quality.name) || 'Unknown',
      allowed: !!item.allowed,
      group: isGroup,
    };
  }).reverse();
}

// edits: { name?, upgradeAllowed?, cutoff?, allowed?: { [index]: bool },
//          minFormatScore?, cutoffFormatScore?, minUpgradeFormatScore?,
//          scores?: { [formatId]: number } }
// Returns a new profile object ready to PUT, or throws with a reason.
export function applyProfileEdits(profile, edits = {}) {
  const next = JSON.parse(JSON.stringify(profile || {}));
  if (edits.name !== undefined) {
    const name = String(edits.name).trim();
    if (!name) throw new Error('Profile name is required');
    next.name = name.slice(0, 100);
  }
  if (edits.upgradeAllowed !== undefined) next.upgradeAllowed = !!edits.upgradeAllowed;
  for (const [index, on] of Object.entries(edits.allowed || {})) {
    const item = next.items && next.items[Number(index)];
    if (!item) continue;
    item.allowed = !!on;
    if (item.items) for (const q of item.items) q.allowed = !!on;
  }
  const rows = profileRows(next);
  if (!rows.some((r) => r.allowed)) throw new Error('Allow at least one quality');
  if (edits.cutoff !== undefined) next.cutoff = Number(edits.cutoff);
  if (!rows.some((r) => r.allowed && r.cutoffId === next.cutoff)) {
    // Sonarr/Radarr reject a cutoff that isn't allowed; use the best allowed.
    next.cutoff = rows.find((r) => r.allowed).cutoffId;
  }
  for (const field of ['minFormatScore', 'cutoffFormatScore', 'minUpgradeFormatScore']) {
    if (edits[field] === undefined || edits[field] === '') continue;
    const n = Number(edits[field]);
    if (!Number.isInteger(n)) throw new Error(`${field} must be a whole number`);
    next[field] = n;
  }
  for (const [formatId, score] of Object.entries(edits.scores || {})) {
    const n = Number(score);
    if (!Number.isInteger(n)) throw new Error('Format scores must be whole numbers');
    const fi = (next.formatItems || []).find((f) => String(f.format) === String(formatId));
    if (fi) fi.score = n;
    else (next.formatItems = next.formatItems || []).push({ format: Number(formatId), score: n });
  }
  return next;
}

// edits: { name?, includeCustomFormatWhenRenaming?, specs?: { [index]: { negate?, required?, value? } } }
export function applyFormatEdits(format, edits = {}) {
  const next = JSON.parse(JSON.stringify(format || {}));
  if (edits.name !== undefined) {
    const name = String(edits.name).trim();
    if (!name) throw new Error('Format name is required');
    next.name = name.slice(0, 100);
  }
  if (edits.includeCustomFormatWhenRenaming !== undefined) next.includeCustomFormatWhenRenaming = !!edits.includeCustomFormatWhenRenaming;
  for (const [index, change] of Object.entries(edits.specs || {})) {
    const spec = next.specifications && next.specifications[Number(index)];
    if (!spec) continue;
    if (change.negate !== undefined) spec.negate = !!change.negate;
    if (change.required !== undefined) spec.required = !!change.required;
    if (change.value !== undefined) {
      const field = (spec.fields || []).find((f) => f && f.name === 'value');
      if (field) {
        // Patterns are .NET regular expressions; Sonarr/Radarr validate them.
        field.value = typeof field.value === 'number' ? Number(change.value) : String(change.value);
      }
    }
  }
  return next;
}

// Move the quality/group at display row `rowIndex` (best first) up or down.
// Sonarr/Radarr store items worst first, so the stored order is reversed.
export function moveProfileItem(profile, rowIndex, delta) {
  const next = JSON.parse(JSON.stringify(profile || {}));
  const items = next.items || [];
  const n = items.length;
  const from = n - 1 - rowIndex;
  const to = from - delta; // up in the list = later in storage
  if (from < 0 || from >= n || to < 0 || to >= n) return next;
  const [it] = items.splice(from, 1);
  items.splice(to, 0, it);
  return next;
}

// Remove a condition (a format needs at least one) or duplicate one.
export function removeFormatSpec(format, index) {
  const next = JSON.parse(JSON.stringify(format || {}));
  if ((next.specifications || []).length <= 1) throw new Error('A custom format needs at least one condition');
  next.specifications.splice(index, 1);
  return next;
}
export function duplicateFormatSpec(format, index) {
  const next = JSON.parse(JSON.stringify(format || {}));
  const spec = (next.specifications || [])[index];
  if (!spec) return next;
  const copy = JSON.parse(JSON.stringify(spec));
  delete copy.id;
  copy.name = `${spec.name || 'Condition'} (copy)`;
  next.specifications.splice(index + 1, 0, copy);
  return next;
}
