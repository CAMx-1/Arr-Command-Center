// Listenarr (audiobooks): Library, Wanted, Queue, History, and Add (metadata
// search → add to library with a quality profile). Data access and payload
// normalization live in lib/listenarr.js.
import { h, mount, tabs, skeletonList, empty, toast, fmtBytes, fmtRelative, pct, poster, autoRefresh, rootFolderLabel } from '../lib/ui.js';
import { listenarrClient, BOOK_STATUS, isInLibrary } from '../lib/listenarr.js';
import { toastWithUndo } from '../lib/queueActions.js';

const section = (label) => h('div', { class: 'section-title' }, label);
const failed = (root, what, err, retry) => mount(root, empty('⚠️', `Failed to load ${what}`, err.message, retry ? { label: 'Retry', onClick: retry } : undefined));
const fmtMinutes = (m) => { const n = Math.round(Number(m) || 0); if (!n) return ''; const hh = Math.floor(n / 60); return hh ? `${hh}h ${n % 60}m` : `${n}m`; };
const fmtEta = (s) => { const n = Math.round(Number(s) || 0); if (!n) return ''; const hh = Math.floor(n / 3600), mm = Math.floor((n % 3600) / 60); return hh ? `${hh}h ${mm}m` : `${mm}m`; };

function tabLoader(root, what, render, { refreshMs = 0 } = {}) {
  const wrap = h('div', {});
  mount(root, wrap);
  const load = async (silent = false) => {
    if (!silent) mount(wrap, skeletonList());
    try { await render(wrap, () => load(true)); } catch (err) { if (!silent) failed(wrap, what, err, () => load(false)); }
  };
  load(false);
  if (refreshMs) autoRefresh(wrap, refreshMs, () => load(true));
}

export async function renderListenarr(root, ctx) {
  const client = listenarrClient(ctx.api, ctx.service.key);
  ctx.setActions(h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.setParams({ tab: 'add' }, { reload: true }) }, '+ Add Audiobook'));
  const defs = [
    { id: 'library', label: 'Library', render: (c) => libraryTab(c, client, ctx, false) },
    { id: 'wanted', label: 'Wanted', render: (c) => libraryTab(c, client, ctx, true) },
    { id: 'queue', label: 'Queue', render: (c) => queueTab(c, client) },
    { id: 'history', label: 'History', render: (c) => historyTab(c, client) },
    { id: 'add', label: 'Add', render: (c) => addTab(c, client, ctx) },
  ];
  const body = h('div', {});
  const bar = tabs(body, defs, `tabs-${ctx.service.key}`, {
    activeId: ctx.params.tab,
    // Each tab has its own filter/search text, so don't carry q across tabs.
    onChange: (id) => ctx.setParams({ tab: id === defs[0].id ? '' : id, q: '' }),
  });
  mount(root, bar, body);
}

function bookRow(b, extra = []) {
  const [label, cls] = BOOK_STATUS[b.status] || [b.status || 'Unknown', 'muted'];
  return h('div', { class: 'row' },
    poster(b.cover, '🎧'),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, b.title, b.year ? h('span', { class: 'dim' }, ` (${b.year})`) : null),
      h('div', { class: 'row-sub' }, [b.authors.join(', '), b.series].filter(Boolean).join(' · ')),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        h('span', { class: `pill ${cls}` }, label),
        b.monitored ? null : h('span', { class: 'pill muted' }, 'Unmonitored'),
        b.size ? h('span', {}, fmtBytes(b.size)) : null,
        b.runtime ? h('span', {}, fmtMinutes(b.runtime)) : null,
        b.narrators.length ? h('span', { class: 'dim' }, `Narrated by ${b.narrators.slice(0, 2).join(', ')}`) : null,
      ),
    ),
    extra.length ? h('div', { class: 'row-actions' }, ...extra) : null,
  );
}

function libraryTab(root, client, ctx, wantedOnly) {
  tabLoader(root, wantedOnly ? 'wanted audiobooks' : 'library', async (wrap) => {
    const all = await client.library();
    const books = (wantedOnly ? all.filter((b) => b.wanted) : all).sort((a, b) => a.title.localeCompare(b.title));
    const filter = h('input', { class: 'input lib-filter-search', type: 'search', placeholder: 'Filter by title, author or series…', value: ctx.params.q || '', 'aria-label': 'Filter audiobooks' });
    const listEl = h('div', {});
    const searchBtn = (b) => h('button', { class: 'btn sm', type: 'button', onclick: async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Searching…';
      try {
        const r = await client.searchAndDownload(b.id);
        if (r && r.success === false) throw new Error(r.message || 'No matching release found');
        toast(r && r.indexerUsed ? `Grabbed from ${r.indexerUsed}` : `Search started for ${b.title}`, 'success');
        btn.textContent = 'Sent';
      } catch (err) { toast(err.message || 'Search failed', 'error'); btn.disabled = false; btn.textContent = 'Search'; }
    } }, 'Search');
    const paint = () => {
      const q = filter.value.trim().toLowerCase();
      const shown = q ? books.filter((b) => `${b.title} ${b.authors.join(' ')} ${b.series}`.toLowerCase().includes(q)) : books;
      mount(listEl, shown.length
        ? h('div', { class: 'list' }, ...shown.slice(0, 300).map((b) => bookRow(b, wantedOnly || !b.hasFiles ? [searchBtn(b)] : [])))
        : empty('🎧', wantedOnly ? 'Nothing wanted' : (q ? 'No matches' : 'Library is empty'), wantedOnly ? 'Every monitored audiobook has files' : (q ? 'Try a different filter' : 'Add audiobooks from the Add tab')));
    };
    filter.addEventListener('input', () => { paint(); ctx.setParams({ q: filter.value.trim() }); });
    const missing = all.filter((b) => b.wanted).length;
    mount(wrap,
      h('div', { class: 'lib-head' }, h('div', { class: 'lib-filter' }, filter)),
      h('div', { class: 'dim', style: { fontSize: '13px', margin: '-4px 0 10px' } },
        wantedOnly ? `${books.length} monitored without files` : `${all.length} audiobooks · ${missing} missing · ${fmtBytes(all.reduce((s, b) => s + b.size, 0))}`),
      listEl);
    paint();
  });
}

function queueTab(root, client) {
  tabLoader(root, 'queue', async (wrap, reload) => {
    const items = await client.queue();
    if (!items.length) return mount(wrap, empty('📥', 'Queue is empty', 'Active audiobook downloads show up here'));
    mount(wrap, h('div', { class: 'list' }, ...items.map((q) => {
      const row = h('div', { class: 'row' },
        poster(null, '🎧'),
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, q.title),
          q.author ? h('div', { class: 'row-sub' }, q.author) : null,
          h('div', { class: 'meta-line', style: { marginTop: '4px' } },
            h('span', { class: `pill ${q.status === 'failed' ? 'down' : q.status === 'completed' ? 'ok' : 'info'}` }, q.status[0].toUpperCase() + q.status.slice(1)),
            q.client ? h('span', { class: 'pill muted' }, q.client) : null,
            q.size ? h('span', {}, `${fmtBytes(q.downloaded)} / ${fmtBytes(q.size)}`) : null,
            q.speed ? h('span', {}, `↓ ${fmtBytes(q.speed)}/s`) : null,
            q.eta ? h('span', {}, `ETA ${fmtEta(q.eta)}`) : null,
            q.quality ? h('span', { class: 'dim' }, q.quality) : null,
          ),
          q.error ? h('div', { class: 'dim', style: { color: 'var(--red)', fontSize: '12px', marginTop: '4px' } }, q.error) : null,
          h('div', { class: 'progress' }, h('span', { style: { width: pct(q.progress) } })),
        ),
        q.canRemove ? h('div', { class: 'row-actions' }, h('button', { class: 'btn sm danger', type: 'button', title: 'Remove from queue', onclick: () => {
          row.style.opacity = '0.45';
          toastWithUndo(`Removing ${q.title}`, {
            onUndo: () => { row.style.opacity = ''; },
            run: async () => {
              try { await client.removeFromQueue(q); toast(`Removed ${q.title}`, 'success'); reload(); } catch (e) { row.style.opacity = ''; toast(e.message, 'error'); }
            },
          });
        } }, 'Remove')) : null,
      );
      return row;
    })));
  }, { refreshMs: 5000 });
}

function historyTab(root, client) {
  tabLoader(root, 'history', async (wrap) => {
    const rows = await client.history(60);
    if (!rows.length) return mount(wrap, empty('🕘', 'No history yet'));
    const tone = (e) => (/fail|error/i.test(e) ? 'down' : /import|complete|added/i.test(e) ? 'ok' : 'info');
    mount(wrap, h('div', { class: 'list' }, ...rows.map((r) => h('div', { class: 'row' },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title', style: { fontSize: '14px' } }, r.title || r.message || r.event),
        h('div', { class: 'meta-line', style: { marginTop: '2px' } },
          h('span', { class: `pill ${tone(r.event)}` }, r.event.replace(/([a-z])([A-Z])/g, '$1 $2')),
          r.source ? h('span', { class: 'pill muted' }, r.source) : null,
          r.when ? h('span', { class: 'dim' }, fmtRelative(r.when)) : null,
        ),
        r.title && r.message ? h('div', { class: 'row-sub' }, r.message) : null,
      )))));
  });
}

const PROFILE_KEY = (key) => `listenarr-profile-${key}`;
const ROOT_KEY = (key) => `listenarr-root-${key}`;

function addTab(root, client, ctx) {
  const input = h('input', { class: 'input', type: 'search', enterkeyhint: 'search', placeholder: 'Title, author or ASIN…', value: ctx.params.q || '', 'aria-label': 'Search audiobooks' });
  const profileSel = h('select', { class: 'input', 'aria-label': 'Quality profile' }, h('option', {}, 'Loading…'));
  const rootSel = h('select', { class: 'input', 'aria-label': 'Root folder' }, h('option', {}, 'Loading…'));
  const searchChk = h('input', { type: 'checkbox', checked: 'checked' });
  const results = h('div', { class: 'search-results' });
  let library = [];
  const form = h('form', { class: 'search-form', role: 'search', onsubmit: (e) => { e.preventDefault(); input.blur(); run(); } },
    input, h('button', { class: 'btn primary', type: 'submit' }, 'Search'));
  mount(root,
    form,
    h('div', { class: 'quick-add-panel listenarr-add-opts' },
      h('label', { class: 'quick-add-field' }, h('span', { class: 'quick-add-label' }, 'Quality profile'), profileSel),
      h('label', { class: 'quick-add-field' }, h('span', { class: 'quick-add-label' }, 'Root folder'), rootSel),
      h('div', { class: 'quick-add-checks' }, h('label', {}, searchChk, ' Search for a release after adding'))),
    results);

  (async () => {
    try {
      const profiles = await client.profiles();
      const saved = localStorage.getItem(PROFILE_KEY(ctx.service.key));
      const def = profiles.find((p) => String(p.id) === saved) || profiles.find((p) => p.isDefault) || profiles[0];
      mount(profileSel, ...profiles.map((p) => h('option', { value: p.id, selected: def && p.id === def.id ? 'selected' : null }, p.name)));
    } catch { mount(profileSel, h('option', { value: '' }, 'Default')); }
    try {
      const roots = await client.rootFolders();
      const saved = localStorage.getItem(ROOT_KEY(ctx.service.key));
      const def = roots.find((r) => r.path === saved) || roots.find((r) => r.isDefault) || roots[0];
      mount(rootSel, roots.length
        ? roots.map((r) => h('option', { value: r.path, selected: def && r.path === def.path ? 'selected' : null }, rootFolderLabel(r)))
        : h('option', { value: '' }, 'Listenarr default'));
    } catch { mount(rootSel, h('option', { value: '' }, 'Listenarr default')); }
    try { library = await client.library(); } catch { library = []; }
  })();
  profileSel.addEventListener('change', () => { try { localStorage.setItem(PROFILE_KEY(ctx.service.key), profileSel.value); } catch { /* ignore */ } });
  rootSel.addEventListener('change', () => { try { localStorage.setItem(ROOT_KEY(ctx.service.key), rootSel.value); } catch { /* ignore */ } });

  let runId = 0;
  async function run() {
    const q = input.value.trim();
    if (!q) return;
    ctx.setParams({ q });
    const id = ++runId;
    mount(results, skeletonList(3));
    let found;
    try { found = await client.search(q); } catch (e) { if (id === runId) failed(results, 'search results', e, run); return; }
    if (id !== runId) return;
    if (!found.length) return mount(results, empty('🔎', 'No audiobooks found', 'Try the author name or an ASIN'));
    mount(results, h('div', { class: 'list' }, ...found.slice(0, 30).map((r) => {
      const owned = isInLibrary(r, library);
      const addBtn = h('button', { class: 'btn sm primary', type: 'button', disabled: owned ? 'disabled' : null, onclick: async () => {
        addBtn.disabled = true; addBtn.textContent = 'Adding…';
        try {
          // Listenarr expects the book's full folder; ask it to build one inside
          // the chosen root (its own naming rules), else let it use its default.
          let destinationPath;
          if (rootSel.value) {
            try { destinationPath = (await client.previewPath(r, rootSel.value))?.fullPath || undefined; } catch { destinationPath = undefined; }
          }
          await client.add(r, { qualityProfileId: Number(profileSel.value) || undefined, autoSearch: searchChk.checked, destinationPath });
          addBtn.textContent = '✓ Added'; addBtn.classList.add('quick-add-done');
          toast(`Added ${r.title} to ${ctx.service.label}`, 'success');
          library.push({ asin: r.asin, title: r.title, authors: r.authors });
        } catch (e) {
          const already = /already/i.test(e.message || '');
          addBtn.textContent = already ? 'In library' : '+ Add'; addBtn.disabled = already;
          toast(already ? `${r.title} is already in your library` : (e.message || 'Add failed'), already ? 'info' : 'error');
        }
      } }, owned ? 'In library' : '+ Add');
      return h('div', { class: 'row' },
        poster(r.cover, '🎧'),
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, r.title, r.year ? h('span', { class: 'dim' }, ` (${r.year})`) : null),
          h('div', { class: 'row-sub' }, [r.authors.join(', '), r.series].filter(Boolean).join(' · ')),
          h('div', { class: 'meta-line', style: { marginTop: '4px' } },
            owned ? h('span', { class: 'pill ok' }, 'In library') : h('span', { class: 'pill info' }, 'Not in library'),
            r.runtime ? h('span', {}, fmtMinutes(r.runtime)) : null,
            r.narrators.length ? h('span', { class: 'dim' }, `Narrated by ${r.narrators.slice(0, 2).join(', ')}`) : null,
            r.asin ? h('span', { class: 'dim' }, r.asin) : null,
          ),
        ),
        h('div', { class: 'row-actions' }, addBtn));
    })));
  }
  if (input.value) run();
}

// Overview card stats.
export async function listenarrStats(api, svc) {
  const c = listenarrClient(api, svc.key);
  const [books, queue] = await Promise.all([c.library(), c.queue().catch(() => [])]);
  return { books: books.length, queue: queue.length, wanted: books.filter((b) => b.wanted).length };
}
