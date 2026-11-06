// TRaSH Guides source (server side). Reads the public TRaSH-Guides/Guides
// repository: one GitHub tree call lists the quality profiles and custom
// formats, then the JSON files are fetched from raw.githubusercontent.com.
// Custom formats are indexed by trash_id (file names don't contain it), and
// everything is cached for a day so phones don't each hit GitHub.

const REPO = 'TRaSH-Guides/Guides';
const BRANCH = 'master';
const APPS = new Set(['radarr', 'sonarr']);

export function createTrashSource({ fetchImpl = globalThis.fetch, ttlMs = 24 * 3600 * 1000, now = () => Date.now(), concurrency = 8 } = {}) {
  const cache = new Map();
  const inflight = new Map();
  const cached = async (key, load) => {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.value;
    if (inflight.has(key)) return inflight.get(key); // share an in-flight load
    const pending = load().then((value) => { cache.set(key, { at: now(), value }); return value; }).finally(() => inflight.delete(key));
    inflight.set(key, pending);
    return pending;
  };
  const getJson = async (url) => {
    const r = await fetchImpl(url, { headers: { accept: 'application/json', 'user-agent': 'arr-command-center' } });
    if (!r.ok) throw new Error(`TRaSH Guides: HTTP ${r.status} for ${url.split('/').slice(-2).join('/')}`);
    return r.json();
  };
  const raw = (path) => `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${path}`;

  const tree = () => cached('tree', async () => {
    const t = await getJson(`https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`);
    return (t.tree || []).map((x) => x.path).filter((p) => /^docs\/json\/(radarr|sonarr)\/(cf|quality-profiles)\/[^/]+\.json$/.test(p));
  });

  async function profiles(app) {
    if (!APPS.has(app)) throw new Error('TRaSH sync supports Radarr and Sonarr');
    return cached(`profiles:${app}`, async () => {
      const files = (await tree()).filter((p) => p.startsWith(`docs/json/${app}/quality-profiles/`));
      const list = await pool(files, concurrency, async (p) => { try { return { slug: p.split('/').pop().replace(/\.json$/, ''), ...(await getJson(raw(p))) }; } catch { return null; } });
      return list.filter(Boolean).map((p) => ({ slug: p.slug, name: p.name, group: p.group ?? 99, description: String(p.trash_description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), url: p.trash_url || '', formats: Object.keys(p.formatItems || {}).length, profile: p }))
        .sort((a, b) => a.group - b.group || a.name.localeCompare(b.name));
    });
  }

  async function formats(app) {
    return cached(`cfs:${app}`, async () => {
      const files = (await tree()).filter((p) => p.startsWith(`docs/json/${app}/cf/`));
      const list = await pool(files, concurrency, async (p) => { try { return await getJson(raw(p)); } catch { return null; } });
      return new Map(list.filter((c) => c && c.trash_id).map((c) => [c.trash_id, c]));
    });
  }

  // A profile plus the custom formats it uses.
  async function profileWithFormats(app, slug) {
    const p = (await profiles(app)).find((x) => x.slug === slug);
    if (!p) throw Object.assign(new Error('Unknown TRaSH profile'), { status: 404 });
    const all = await formats(app);
    const used = Object.values(p.profile.formatItems || {});
    return { profile: p.profile, formats: used.map((id) => all.get(id)).filter(Boolean) };
  }

  return { profiles, formats, profileWithFormats, clear: () => cache.clear() };
}

async function pool(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => { while (next < list.length) { const i = next++; out[i] = await fn(list[i]); } }));
  return out;
}

// Small offline set for demo mode (same shapes as the real files).
export function demoTrashSource() {
  const cf = (trash_id, name, scores, specs) => ({ trash_id, trash_scores: scores, name, includeCustomFormatWhenRenaming: false, specifications: specs });
  const title = (name, value, extra = {}) => ({ name, implementation: 'ReleaseTitleSpecification', negate: false, required: false, fields: { value }, ...extra });
  const formats = [
    cf('dc98083864ea246d05a42df0d05f81cc', 'x265 (HD)', { default: -10000 }, [title('x265/HEVC', '[xh][ ._-]?265|\\bHEVC(\\b|\\d)', { required: true }), { name: 'Not 2160p', implementation: 'ResolutionSpecification', negate: true, required: true, fields: { value: 2160 } }]),
    cf('ed27ebfef2f323e964fb1f61391bcb35', 'HD Bluray Tier 01', { default: 1800 }, [title('BBQ', '^(BBQ)$', { implementation: 'ReleaseGroupSpecification' })]),
    cf('e7718d7a3ce595f289bfee26adc178f5', 'Repack/Proper', { default: 5 }, [title('Repack', '\\b(repack|proper)\\b')]),
    cf('ae9b7c9ebde1f3bd336a8cbd1ec4c5e5', 'No-RlsGroup', { default: -10000 }, [title('No release group', '^(?!.*-\\w+$).*')]),
    cf('b6832f586342ef70d9c128d40c07b872', 'Bad Dual Groups', { default: -10000 }, [title('Bad groups', '\\b(alfaHD|BAT)\\b', { implementation: 'ReleaseGroupSpecification' })]),
    // Same name as a demo format, different rule: shows an "update".
    cf('c9eafd50846d299b862ca9bb6ea91950', 'x265', { default: 0, 'sqp-1-1080p': -10000 }, [title('x265', '\\b(x|h)\\.?265\\b')]),
  ];
  const index = new Map(formats.map((c) => [c.trash_id, c]));
  const profile = (slug, name, items, extra = {}) => ({ slug, name, trash_id: slug, group: 1, upgradeAllowed: true, cutoff: 'Bluray-1080p', minFormatScore: 0, cutoffFormatScore: 10000, minUpgradeFormatScore: 1, formatItems: items, ...extra });
  const radarr = [
    profile('hd-bluray-web', 'HD Bluray + WEB', { 'HD Bluray Tier 01': 'ed27ebfef2f323e964fb1f61391bcb35', 'Repack/Proper': 'e7718d7a3ce595f289bfee26adc178f5', 'x265 (HD)': 'dc98083864ea246d05a42df0d05f81cc', 'No-RlsGroup': 'ae9b7c9ebde1f3bd336a8cbd1ec4c5e5', 'Bad Dual Groups': 'b6832f586342ef70d9c128d40c07b872', x265: 'c9eafd50846d299b862ca9bb6ea91950' }, { trash_description: 'Covers WEBDL 1080p and Bluray 720p/1080p.' }),
    profile('sqp-1-1080p', '[SQP] SQP-1 (1080p)', { x265: 'c9eafd50846d299b862ca9bb6ea91950', 'Repack/Proper': 'e7718d7a3ce595f289bfee26adc178f5' }, { group: 98, trash_score_set: 'sqp-1-1080p', minFormatScore: 1000 }),
  ];
  const list = (app) => (app === 'sonarr' ? radarr.slice(0, 1).map((p) => ({ ...p, slug: 'web-1080p', name: 'WEB-1080p', cutoff: 'WEB 1080p' })) : radarr);
  return {
    async profiles(app) { return list(app).map((p) => ({ slug: p.slug, name: p.name, group: p.group, description: p.trash_description || '', url: '', formats: Object.keys(p.formatItems).length, profile: p })); },
    async formats() { return index; },
    async profileWithFormats(app, slug) {
      const p = list(app).find((x) => x.slug === slug);
      if (!p) throw Object.assign(new Error('Unknown TRaSH profile'), { status: 404 });
      return { profile: p, formats: Object.values(p.formatItems).map((id) => index.get(id)).filter(Boolean) };
    },
    clear() {},
  };
}
