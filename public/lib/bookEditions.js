// Pure helpers for a book's editions (Chaptarr, legacy Readarr): which one
// the book uses, the others grouped by narrator for audiobooks, and the
// PUT book/{id} body that switches to another one. The UI is
// lib/bookEditionsUI.js.
//
// Chaptarr lists every edition of the work (audiobook and ebook) under
// GET edition?bookId=. Submitting one edition with monitored: true pins it
// (anyEditionOk false, "Automatically switch edition" off): Chaptarr links
// the book's files to it and, for an audio edition, sets their recording
// type; the files stay in their folders. Readarr keeps the editions on the
// book and wants the whole list back with one monitored.

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

export function editionIsEbook(e) {
  if (!e) return false;
  if (typeof e.isEbook === 'boolean') return e.isEbook;
  return /^(ebook|e-book|kindle|epub|digital)$/i.test(String(e.format || ''));
}
export const editionFormat = (e) => (editionIsEbook(e) ? 'ebook' : 'audiobook');

// The editions that fit a book: Chaptarr books are one format each.
export function editionsForBook(editions, book) {
  const list = (Array.isArray(editions) ? editions : []).filter(Boolean);
  const mt = book && book.mediaType;
  if (mt !== 'audiobook' && mt !== 'ebook') return list;
  return list.filter((e) => editionFormat(e) === mt);
}

export function editionNarrators(e) {
  if (!e) return [];
  const names = Array.isArray(e.narratorNames) && e.narratorNames.length ? e.narratorNames
    : Array.isArray(e.narrators) && e.narrators.length ? e.narrators.map((n) => (typeof n === 'string' ? n : n && n.name))
      : e.narrator ? String(e.narrator).split(/\s*[,;&]\s*/) : [];
  const seen = new Set();
  return names.map(clean).filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
}

// 30300 -> "8h 25m"; under a minute -> "".
export function durationText(seconds) {
  const s = Math.round(Number(seconds) || 0);
  if (s < 60) return '';
  const hh = Math.floor(s / 3600); const mm = Math.floor((s % 3600) / 60);
  return hh ? `${hh}h${mm ? ` ${mm}m` : ''}` : `${mm}m`;
}

export function editionYear(e) {
  const t = Date.parse(e && e.releaseDate);
  return Number.isFinite(t) ? new Date(t).getUTCFullYear() : null;
}

const LANGUAGES = {
  eng: 'English', en: 'English', ger: 'German', deu: 'German', de: 'German', fre: 'French', fra: 'French', fr: 'French',
  spa: 'Spanish', es: 'Spanish', ita: 'Italian', it: 'Italian', dut: 'Dutch', nld: 'Dutch', nl: 'Dutch', swe: 'Swedish', sv: 'Swedish',
  dan: 'Danish', da: 'Danish', nor: 'Norwegian', nob: 'Norwegian', no: 'Norwegian', fin: 'Finnish', fi: 'Finnish', pol: 'Polish', pl: 'Polish',
  por: 'Portuguese', pt: 'Portuguese', rus: 'Russian', ru: 'Russian', jpn: 'Japanese', ja: 'Japanese', kor: 'Korean', ko: 'Korean',
  chi: 'Chinese', zho: 'Chinese', zh: 'Chinese', cze: 'Czech', ces: 'Czech', cs: 'Czech', hun: 'Hungarian', hu: 'Hungarian', tur: 'Turkish', tr: 'Turkish',
};
export function languageName(code) {
  const c = String(code || '').trim();
  if (!c) return '';
  return LANGUAGES[c.toLowerCase()] || c.toUpperCase();
}

// A cover the browser can load. Chaptarr hands edition covers out through
// its own /MediaCoverProxy (needs its login); the proxied file keeps the
// Amazon image name, which is public on Amazon's image CDN. Amazon image IDs
// are 11 characters with capital letters ("51xJbFMRsxL", "51ym2M+-kiL").
// Goodreads names ("132248439._SX50_.jpg"), hashes and UUIDs are not, and
// Amazon answers those with a 400.
const AMAZON_IMAGE = /^(?=[^.]*[A-Z])[0-9A-Za-z+-]{11}(\._[0-9A-Za-z,_]+)?\.(jpe?g|png)$/;
function amazonImageName(url) {
  const raw = String(url || '');
  if (!/\/MediaCoverProxy\//i.test(raw)) return '';
  let file;
  try { file = decodeURIComponent(raw.split(/[?#]/)[0].split('/').pop()); } catch { return ''; }
  return AMAZON_IMAGE.test(file) ? file : '';
}
export function editionCover(e) {
  const images = Array.isArray(e && e.images) ? e.images : [];
  for (const img of images) {
    if (!img) continue;
    for (const u of [img.remoteUrl, img.url]) if (typeof u === 'string' && (/^https?:\/\//i.test(u) || /^data:image\//i.test(u))) return u;
  }
  for (const img of images) {
    const file = amazonImageName(img && img.url);
    if (file) return `https://m.media-amazon.com/images/I/${encodeURIComponent(file)}`;
  }
  return '';
}

export const isCurrentEdition = (e) => !!(e && e.monitored);
export function currentEdition(editions) {
  return (Array.isArray(editions) ? editions : []).find(isCurrentEdition) || null;
}

// Which edition of several is most useful to show first: one with files,
// with a length and an ASIN (what release matching uses), popular, recent.
export function editionScore(e) {
  if (!e) return 0;
  const votes = Number(e.ratings && e.ratings.votes) || 0;
  const year = editionYear(e) || 0;
  return (Number(e.bookFileCount) > 0 ? 1e7 : 0)
    + (Number(e.durationSeconds) > 0 ? 4e6 : 0) + (e.asin || e.audibleASIN ? 2e6 : 0) + (e.isbn13 || e.isbn10 ? 5e5 : 0)
    + Math.min(9e5, Math.log10(votes + 1) * 1e5) + year;
}
const byScore = (a, b) => editionScore(b) - editionScore(a) || (Number(a.id) || 0) - (Number(b.id) || 0);

// Audiobook editions grouped by narrator (the choice that matters), the
// group in use first; ebook editions in one group.
export function groupEditions(editions, mediaType = '') {
  const list = (Array.isArray(editions) ? editions : []).filter(Boolean);
  if (mediaType === 'ebook' || (mediaType !== 'audiobook' && list.every(editionIsEbook))) {
    return list.length ? [{ key: 'all', label: '', editions: [...list].sort((a, b) => (isCurrentEdition(b) - isCurrentEdition(a)) || byScore(a, b)) }] : [];
  }
  const groups = new Map();
  for (const e of list) {
    const names = editionNarrators(e);
    const key = names.length ? names.map((n) => n.toLowerCase()).sort().join(' & ') : '';
    if (!groups.has(key)) groups.set(key, { key: key || 'none', label: names.join(', '), editions: [] });
    groups.get(key).editions.push(e);
  }
  const out = [...groups.values()].map((g) => ({ ...g, editions: g.editions.sort((a, b) => (isCurrentEdition(b) - isCurrentEdition(a)) || byScore(a, b)) }));
  const best = (g) => Math.max(...g.editions.map(editionScore));
  out.sort((a, b) => (b.editions.some(isCurrentEdition) - a.editions.some(isCurrentEdition))
    || ((a.key === 'none') - (b.key === 'none')) || best(b) - best(a) || b.editions.length - a.editions.length);
  return out;
}

// The facts worth comparing editions on, in a fixed order.
export function editionFacts(e) {
  if (!e) return [];
  const ebook = editionIsEbook(e);
  return [
    ['Narrator', ebook ? '' : editionNarrators(e).join(', ')],
    ['Length', ebook ? '' : durationText(e.durationSeconds)],
    ['Pages', ebook && Number(e.pageCount) > 0 ? String(e.pageCount) : ''],
    ['Publisher', clean(e.publisher)],
    ['Released', editionYear(e) ? String(editionYear(e)) : ''],
    ['Language', languageName(e.language)],
    ['ASIN', e.asin || e.audibleASIN || ''],
    ['ISBN', e.isbn13 || e.isbn10 || ''],
  ].filter(([, v]) => v);
}

export function matchesEdition(e, term) {
  const t = clean(term).toLowerCase();
  if (!t) return true;
  return [e.title, e.subtitle, e.publisher, e.language, languageName(e.language), e.asin, e.audibleASIN, e.isbn13, e.isbn10, editionYear(e), ...editionNarrators(e)]
    .some((v) => v !== null && v !== undefined && String(v).toLowerCase().includes(t));
}

// PUT book/{id} body that makes `edition` the one the book uses.
export function selectEditionBody(book, edition) {
  const out = { ...(book || {}) };
  const chosenId = edition && edition.id;
  if (Array.isArray(out.editions) && out.editions.length) {
    // Readarr (and Chaptarr when the book came with its editions): the
    // whole list, one monitored.
    out.editions = out.editions.map((e) => ({ ...e, monitored: e.id === chosenId }));
    if (!out.editions.some((e) => e.id === chosenId)) out.editions.push({ ...edition, monitored: true });
  } else {
    out.editions = [{ ...edition, monitored: true }];
  }
  if ('anyEditionOk' in out) out.anyEditionOk = false;
  return out;
}

// PUT book/{id} body that turns "Automatically switch edition" on or off.
export function autoSwitchBody(book, on) {
  const { editions, ...rest } = book || {};
  return { ...rest, anyEditionOk: !!on };
}

// "Stephen Fry · 8h 25m · Pottermore Publishing · 2015", for a one-line label.
export function editionLine(e) {
  if (!e) return '';
  const ebook = editionIsEbook(e);
  return [
    ebook ? '' : editionNarrators(e).join(', '),
    ebook ? (Number(e.pageCount) > 0 ? `${e.pageCount} pages` : '') : durationText(e.durationSeconds),
    clean(e.publisher), editionYear(e) ? String(editionYear(e)) : '',
  ].filter(Boolean).join(' · ');
}
