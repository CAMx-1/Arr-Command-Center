// Pure helpers for reading an *arr app's log files (Chaptarr, Readarr, the
// rest of the family): parse the lines, turn each message into a pattern
// (paths, numbers, ids and quoted titles taken out), and count how often each
// pattern happened, when first and last. The UI is lib/bookLogsUI.js.
//
// A log line is "2026-11-23 02:04:25.2|Error|DownloadedBooksImportService|
// message", in UTC; an exception follows on the next lines.

export const LEVELS = ['Trace', 'Debug', 'Info', 'Warn', 'Error', 'Fatal'];
export function levelRank(level) {
  const i = LEVELS.findIndex((l) => l.toLowerCase() === String(level || '').toLowerCase());
  return i < 0 ? 2 : i;
}

const LINE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)\|([A-Za-z]+)\|([^|]*)\|(.*)$/;
const MAX_EXTRA_LINES = 14;

export function parseLogText(text, { source = '' } = {}) {
  const out = [];
  let last = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const m = raw.match(LINE);
    if (m) {
      const time = Date.parse(`${m[1]}T${m[2]}Z`);
      last = { time: Number.isFinite(time) ? time : 0, level: m[3], logger: m[4].trim(), message: m[5].trim(), extra: [], source };
      out.push(last);
    } else if (last && raw.trim() && last.extra.length < MAX_EXTRA_LINES) {
      last.extra.push(raw.replace(/\s+$/, ''));
    }
  }
  return out;
}

// ---- Message patterns ------------------------------------------------------

// Words that end a path written into a sentence ("… in /x/y but this …").
// Lowercase only: titles in folder names are capitalised ("This Is How…").
const PATH_STOP = /^\s(?:but|does|doesn['’]t|is|was|could|cannot|because|which|while)\s/;
const CLOSERS = { "'": "'", '"': '"', '[': ']', '(': ')' };

// A ". " that ends a sentence, not an initial ("C.J. Box", "Sarah J. Maas").
function sentenceEnd(msg, j) {
  if (!/^\.\s+[A-Z]/.test(msg.slice(j))) return false;
  const before = msg[j - 1] || '';
  const initial = /[A-Z]/.test(before) && !/[A-Za-z]/.test(msg[j - 2] || ' ');
  return !initial;
}

// Absolute POSIX paths in a message. Folder names often hold spaces, commas,
// dots and brackets, so a path runs until the quote or bracket it was opened
// with, a pipe, a sentence end, a lowercase stop word or the end.
function replacePaths(msg) {
  let out = '';
  let i = 0;
  while (i < msg.length) {
    const ch = msg[i];
    const prev = i ? msg[i - 1] : ' ';
    const starts = ch === '/' && /[\s'"([:=]/.test(prev) && /^\/[^\s/]+\//.test(msg.slice(i));
    if (!starts) { out += ch; i++; continue; }
    const closer = CLOSERS[prev] || '';
    let j = i;
    let end = msg.length;
    while (j < msg.length) {
      const c = msg[j];
      if (c === '|' || c === '\n') { end = j; break; }
      if (closer && c === closer && (closer === "'" || closer === '"' || /^.(\s|$|[,:;.])/.test(msg.slice(j, j + 2)))) { end = j; break; }
      if (c === '.' && sentenceEnd(msg, j)) { end = j; break; }
      if (c === ' ' && PATH_STOP.test(msg.slice(j, j + 12))) { end = j; break; }
      j++;
    }
    const trail = msg.slice(i, end).match(/[.,;:]+$/);
    if (trail) end -= trail[0].length;
    out += '‹path›';
    i = end;
  }
  return out;
}

// Square brackets hold either a fixed tag ([HOLY-GRAIL], [main-tags]) or a
// value (a title, an id), sometimes with brackets inside ("[It [Paperback]]").
// Values become ‹…›; tags stay.
const BRACKET_TAG = /^(?:[A-Z0-9][A-Z0-9_-]{1,30}|[a-z][a-z/_-]{1,30})$/;
function replaceBrackets(msg) {
  let out = '';
  let i = 0;
  while (i < msg.length) {
    if (msg[i] !== '[') { out += msg[i++]; continue; }
    let depth = 0; let j = i;
    for (; j < msg.length; j++) {
      if (msg[j] === '[') depth++;
      else if (msg[j] === ']' && --depth === 0) break;
    }
    if (j >= msg.length) { out += msg.slice(i); break; } // unbalanced: leave the rest
    const inner = msg.slice(i + 1, j);
    out += BRACKET_TAG.test(inner) || inner === '‹…›' ? `[${inner}]` : '[‹…›]';
    i = j + 1;
  }
  return out;
}

export function normalizeLogMessage(message) {
  let m = String(message || '').replace(/\s+/g, ' ').trim();
  m = m.replace(/https?:\/\/\S+/gi, '‹url›');
  m = replacePaths(m);
  m = m.replace(/(^|[\s(\[:=])'[^']{1,200}'(?=$|[\s),.:;\]])/g, "$1'‹…›'").replace(/(^|[\s(\[:=])"[^"]{1,200}"(?=$|[\s),.:;\]])/g, '$1"‹…›"');
  m = replaceBrackets(m);
  m = m.replace(/\b(?:hc-ed|gr-ed|hc|gr|az|ol|gb|isbn|asin|edition)[:-][A-Za-z0-9_:-]+/gi, '‹id›');
  m = m.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '‹id›').replace(/\b[0-9a-f]{16,}\b/gi, '‹id›');
  m = m.replace(/\b\d+(?:[.,:]\d+)*\b/g, 'N');
  // Lists of ids or numbers vary in length from one line to the next.
  m = m.replace(/‹id›(?:\s*[|,;]\s*‹id›)+/g, '‹ids›').replace(/\bN(?:\s*[|,;]\s*N\b)+/g, 'N…');
  m = m.replace(/\s+/g, ' ').trim();
  // Very long messages (lists of books, ids) are grouped on how they start.
  return m.length > PATTERN_MAX ? `${m.slice(0, PATTERN_MAX).replace(/\s+\S*$/, '')} …` : m;
}
const PATTERN_MAX = 220;

// ---- Groups ----------------------------------------------------------------

const KEEP_EXAMPLES = 5;

//   entries: from parseLogText; minLevel: 'Warn' keeps warnings and worse.
export function groupLogEntries(entries, { minLevel = 'Warn', term = '' } = {}) {
  const floor = levelRank(minLevel);
  const t = String(term || '').trim().toLowerCase();
  const groups = new Map();
  for (const e of entries || []) {
    if (levelRank(e.level) < floor) continue;
    const pattern = normalizeLogMessage(e.message);
    const key = `${e.level}|${e.logger}|${pattern}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, level: e.level, logger: e.logger, pattern, count: 0, first: e.time, last: e.time, examples: [] };
      groups.set(key, g);
    }
    g.count++;
    if (e.time && (!g.first || e.time < g.first)) g.first = e.time;
    if (e.time && e.time >= g.last) g.last = e.time;
    g.examples.push(e);
    if (g.examples.length > KEEP_EXAMPLES * 2) g.examples = g.examples.sort((a, b) => b.time - a.time).slice(0, KEEP_EXAMPLES);
  }
  const list = [...groups.values()].map((g) => ({ ...g, examples: g.examples.sort((a, b) => b.time - a.time).slice(0, KEEP_EXAMPLES) }));
  return t ? list.filter((g) => `${g.pattern} ${g.logger} ${g.examples.map((x) => x.message).join(' ')}`.toLowerCase().includes(t)) : list;
}

export function sortLogGroups(groups, by = 'count') {
  const list = [...(groups || [])];
  if (by === 'latest') return list.sort((a, b) => b.last - a.last || b.count - a.count);
  return list.sort((a, b) => b.count - a.count || b.last - a.last || levelRank(b.level) - levelRank(a.level));
}

// How many entries of each level, and the time the lines cover.
export function logSummary(entries) {
  const counts = { Fatal: 0, Error: 0, Warn: 0, Info: 0, Debug: 0, Trace: 0 };
  let from = 0; let to = 0;
  for (const e of entries || []) {
    const lv = LEVELS[levelRank(e.level)];
    counts[lv] = (counts[lv] || 0) + 1;
    if (e.time) { if (!from || e.time < from) from = e.time; if (e.time > to) to = e.time; }
  }
  return { counts, from, to, total: (entries || []).length };
}

// The newest `count` log files (the app lists them newest first already).
export function pickLogFiles(files, count) {
  const list = (Array.isArray(files) ? files : []).filter((f) => f && /\.txt$/i.test(f.filename || ''))
    .sort((a, b) => (Date.parse(b.lastWriteTime) || 0) - (Date.parse(a.lastWriteTime) || 0));
  return count > 0 ? list.slice(0, count) : list;
}

// What a few common problems usually mean, and where ArrCC can fix them.
// {app} stands for the app's name.
export const LOG_HINTS = [
  {
    test: /path does not exist or is not accessible|not accessible to \w+|does not appear to exist inside the container|Download path is not accessible/i,
    text: 'The download client reports a folder {app} can’t see. That usually needs a remote path mapping or a Docker volume.',
    action: 'folders',
  },
  {
    test: /did not produce one physically compatible Book|STAGED-FTS-UNCLEAR|couldn['’]t find a similar book/i,
    text: '{app} couldn’t tell which book these files belong to, so it left them unlinked.',
    action: 'unmapped',
  },
  {
    test: /Unable to connect to|error occurred while processing feed|HTTP Error - Res|Indexer/i,
    text: 'An indexer didn’t answer. It may be down, or limiting how many searches it allows.',
  },
  {
    test: /no valid duration|trustworthy MP3 duration/i,
    text: '{app} couldn’t read how long these files play. They may be damaged or only partly downloaded.',
  },
];
export function logHint(group, app = 'The app') {
  if (!group) return null;
  const text = `${group.logger} ${group.pattern}`;
  const hit = LOG_HINTS.find((h) => h.test.test(text));
  return hit ? { ...hit, text: hit.text.replace(/\{app\}/g, app) } : null;
}
