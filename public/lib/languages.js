// Languages as Sonarr and Radarr report them: media info has the stream tags
// ffprobe reads (ISO 639-2 like "eng" or "fre"/"fra", sometimes 639-1 "en"
// or a name), and series/movies have an originalLanguage name ("English",
// "Portuguese (Brazil)"). Everything maps to one 3-letter code. Pure.

// [code, 639-1, English name, other spellings]
const LANGS = [
  ['eng', 'en', 'English'],
  ['spa', 'es', 'Spanish', ['espanol', 'español', 'castellano', 'latino', 'spanish (latino)', 'spanish (latin america)']],
  ['fre', 'fr', 'French', ['fra', 'francais', 'français', 'french (canada)']],
  ['ger', 'de', 'German', ['deu', 'deutsch']],
  ['ita', 'it', 'Italian', ['italiano']],
  ['por', 'pt', 'Portuguese', ['portuguese (brazil)', 'portuguese (portugal)', 'brazilian', 'pt-br', 'ptbr', 'pob']],
  ['dut', 'nl', 'Dutch', ['nld', 'flemish', 'nederlands']],
  ['swe', 'sv', 'Swedish'],
  ['nor', 'no', 'Norwegian', ['nob', 'nno', 'nb', 'nn', 'norsk', 'norwegian bokmal']],
  ['dan', 'da', 'Danish'],
  ['fin', 'fi', 'Finnish'],
  ['ice', 'is', 'Icelandic', ['isl']],
  ['pol', 'pl', 'Polish'],
  ['cze', 'cs', 'Czech', ['ces']],
  ['slo', 'sk', 'Slovak', ['slk']],
  ['hun', 'hu', 'Hungarian'],
  ['rum', 'ro', 'Romanian', ['ron', 'moldavian']],
  ['bul', 'bg', 'Bulgarian'],
  ['hrv', 'hr', 'Croatian'],
  ['srp', 'sr', 'Serbian'],
  ['slv', 'sl', 'Slovenian', ['slovene']],
  ['gre', 'el', 'Greek', ['ell']],
  ['tur', 'tr', 'Turkish'],
  ['rus', 'ru', 'Russian'],
  ['ukr', 'uk', 'Ukrainian'],
  ['heb', 'he', 'Hebrew', ['iw']],
  ['ara', 'ar', 'Arabic'],
  ['per', 'fa', 'Persian', ['fas', 'farsi']],
  ['hin', 'hi', 'Hindi'],
  ['tam', 'ta', 'Tamil'],
  ['tel', 'te', 'Telugu'],
  ['ben', 'bn', 'Bengali', ['bangla']],
  ['urd', 'ur', 'Urdu'],
  ['mal', 'ml', 'Malayalam'],
  ['kan', 'kn', 'Kannada'],
  ['mar', 'mr', 'Marathi'],
  ['tha', 'th', 'Thai'],
  ['vie', 'vi', 'Vietnamese'],
  ['ind', 'id', 'Indonesian'],
  ['may', 'ms', 'Malay', ['msa']],
  ['fil', 'tl', 'Filipino', ['tgl', 'tagalog']],
  ['chi', 'zh', 'Chinese', ['zho', 'mandarin', 'cantonese', 'cmn', 'yue', 'chinese (simplified)', 'chinese (traditional)']],
  ['jpn', 'ja', 'Japanese'],
  ['kor', 'ko', 'Korean'],
  ['cat', 'ca', 'Catalan'],
  ['est', 'et', 'Estonian'],
  ['lav', 'lv', 'Latvian'],
  ['lit', 'lt', 'Lithuanian'],
  ['wel', 'cy', 'Welsh', ['cym']],
  ['gle', 'ga', 'Irish'],
  ['afr', 'af', 'Afrikaans'],
  ['baq', 'eu', 'Basque', ['eus']],
  ['glg', 'gl', 'Galician'],
];
// "und" (undetermined), "mul" (multiple), "zxx" (no speech), "mis", "qaa"
const UNKNOWN = new Set(['', 'und', 'undefined', 'unknown', 'mis', 'mul', 'zxx', 'qaa', 'any', 'original']);

const INDEX = new Map();
const NAMES = new Map();
for (const [code, two, name, more = []] of LANGS) {
  NAMES.set(code, name);
  for (const k of [code, two, name, ...more]) INDEX.set(String(k).toLowerCase(), code);
}

// One code for a tag, a code, a name or a { name } object; null when unknown.
export function langCode(x) {
  const raw = x && typeof x === 'object' ? (x.name || x.code || '') : x;
  const k = String(raw ?? '').trim().toLowerCase();
  if (UNKNOWN.has(k)) return null;
  return INDEX.get(k) || INDEX.get(k.split(/[-_ (]/)[0]) || null;
}

export function langName(code) { return NAMES.get(code) || String(code || '').toUpperCase(); }

// Media info lists ("eng/ita", "English / Italian"): one code per stream, null
// for streams whose language isn't known, in stream order.
export function langList(value) {
  if (Array.isArray(value)) return value.map(langCode);
  const s = String(value ?? '').trim();
  if (!s) return [];
  return s.split(/\s*[/,|]\s*/).map(langCode);
}

// For pickers: English first, then by name.
export const LANGUAGE_CHOICES = LANGS.map(([code, , name]) => [code, name])
  .sort((a, b) => (a[0] === 'eng' ? -1 : b[0] === 'eng' ? 1 : a[1].localeCompare(b[1])));
