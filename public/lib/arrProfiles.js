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
