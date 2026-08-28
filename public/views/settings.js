import { h, mount, clear, spinner, svcIcon, confirmModal, openModal, closeModal, toast } from '../lib/ui.js';
import { SERVICE_META } from '../app.js';
import { getTheme, getAccent, applyTheme, applyAccent, ACCENTS, ACCENT_NAMES } from '../lib/theme.js';
import { globalMode, setGlobalMode } from '../lib/viewMode.js';
import { isHidden, setHidden, orderServices, setOrder } from '../lib/servicePrefs.js';

export async function renderSettings(root, ctx) {
  const { api, state } = ctx;
  ctx.setActions(
    h('button', { class: 'btn', onclick: () => renderSettings(root, ctx) }, '↻ Refresh'),
  );

  mount(root, spinner());
  let status = {};
  try { status = await api.status(); state.status = status; } catch { /* ignore */ }

  const cfg = state.config || { services: {} };

  const general = h('div', { class: 'card' },
    h('h3', {}, 'General'),
    settingRow('Mode', cfg.mock ? h('span', { class: 'pill warn' }, 'Demo (mock data)') : h('span', { class: 'pill ok' }, 'Live')),
    settingRow('Services configured', String(state.services.length)),
    settingRow('Dashboard', h('span', { class: 'dim' }, 'Arr Command Center')),
    (cfg.auth && cfg.auth.plexEnabled)
      ? settingRow('Signed in as', h('span', {},
          h('span', { style: { marginRight: '10px' } }, cfg.auth.user || 'unknown'),
          h('button', { class: 'btn sm', onclick: () => confirmModal({
            title: 'Sign out',
            message: 'Are you sure you want to sign out?',
            confirmLabel: 'Sign out',
            danger: true,
            onConfirm: async () => {
              try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
              location.href = '/login.html';
            },
          }) }, 'Log out')))
      : null,
  );

  const base = [...state.services].sort((a, b) => (a.type === 'overseerr' ? 0 : 1) - (b.type === 'overseerr' ? 0 : 1));
  const ordered = orderServices(base);
  const orderedKeys = ordered.map((s) => s.key);
  let dragKey = null;
  const reorder = (from, to) => {
    if (!from || from === to) return;
    const arr = [...orderedKeys];
    const fromIdx = arr.indexOf(from);
    const toIdx = arr.indexOf(to);
    if (fromIdx < 0 || toIdx < 0) return;
    arr.splice(fromIdx, 1);
    // After removal, place before the target when moving up, after it when moving down.
    let insertIdx = arr.indexOf(to);
    if (fromIdx < toIdx) insertIdx += 1;
    arr.splice(insertIdx, 0, from);
    setOrder(arr);
    ctx.reload();
  };
  const serviceCards = ordered.map((svc) => {
    const meta = SERVICE_META[svc.type] || {};
    const st = status[svc.key];
    const online = st && st.ok;
    const hidden = isHidden(svc.key);
    return h('div', {
      class: `card svc-card-drag${hidden ? ' svc-hidden-card' : ''}`,
      draggable: 'true',
      dataset: { svcKey: svc.key },
      ondragstart: (e) => { dragKey = svc.key; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', svc.key); } catch { /* ignore */ } e.currentTarget.classList.add('dragging'); },
      ondragover: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragKey && dragKey !== svc.key) e.currentTarget.classList.add('drag-over'); },
      ondragleave: (e) => { e.currentTarget.classList.remove('drag-over'); },
      ondrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); reorder(dragKey, svc.key); },
      ondragend: (e) => { e.currentTarget.classList.remove('dragging'); dragKey = null; },
    },
      h('div', { class: 'svc-head' },
        h('span', { class: 'drag-handle', title: 'Drag to reorder' }, '⠿'),
        h('span', { class: 'svc-icon' }, svcIcon(meta.logo, meta.emoji || '', 26)),
        h('div', {},
          h('div', { class: 'svc-name' }, svc.label),
          h('div', { class: 'svc-meta' }, svc.type + (st && st.version ? ` · v${st.version}` : '')),
        ),
        h('span', { class: `pill ${online ? 'ok' : 'down'} right` }, online ? 'Online' : (st ? 'Offline' : '…')),
      ),
      h('div', { class: 'meta-line', style: { marginTop: '10px' } },
        svc.configured ? h('span', { class: 'pill ok' }, '✓ Configured') : h('span', { class: 'pill warn' }, 'Not configured'),
        svc.hasCloudflareAccess ? h('span', { class: 'pill info' }, 'Cloudflare Access') : h('span', { class: 'pill muted' }, 'No CF Access'),
        svc.embed ? h('span', { class: 'pill muted' }, 'Embedded') : null,
        hidden ? h('span', { class: 'pill muted' }, 'Hidden from nav') : null,
      ),
      h('div', { class: 'meta-line svc-controls', style: { marginTop: '10px' } },
        (st && !st.ok) ? h('button', { class: 'btn sm', title: 'Re-check connection', onclick: () => renderSettings(root, ctx) }, '↻ Retry') : null,
        cfg.mock ? null : h('button', { class: 'btn sm', onclick: () => openServiceForm(root, ctx, svc.key, svc) }, 'Edit'),
        h('button', { class: `btn sm ${hidden ? 'primary' : ''}`, onclick: () => { setHidden(svc.key, !hidden); ctx.reload(); } }, hidden ? 'Show' : 'Hide'),
      ),
      (st && !st.ok && st.error) ? h('div', { class: 'release-reject', style: { marginTop: '8px' } }, st.error) : null,
    );
  });

  const note = h('div', { class: 'card' },
    h('h3', {}, 'Configuration'),
    h('p', { class: 'dim', style: { margin: '0 0 8px', lineHeight: '1.6' } },
      'Services, API keys and Cloudflare Access tokens are configured server-side in ',
      h('span', { class: 'mono' }, 'config.json'),
      ' (or via environment variables). Secrets are never sent to the browser. Edit that file and restart the server to change services.'),
    h('p', { class: 'dim', style: { margin: 0, lineHeight: '1.6' } },
      'A green dot means the service is reachable through the proxy (including Cloudflare Access, when enabled). A red dot means a connection or auth problem.'),
  );

  mount(root,
    h('div', { class: 'section-title' }, 'General'),
    general,
    h('div', { class: 'section-title' }, 'Appearance'),
    appearanceCard(root, ctx),
    h('div', { class: 'section-title' }, 'Services'),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', margin: '-4px 0 12px' } },
      h('div', { class: 'dim', style: { fontSize: '13px', flex: '1' } }, 'Drag a service card to reorder it, and use Hide to remove one from the sidebar and Home (it stays configured and reachable directly).'),
      cfg.mock ? null : h('button', { class: 'btn sm primary hex-btn', onclick: () => openServiceForm(root, ctx, null, null) }, '＋ Add service'),
    ),
    h('div', { class: 'grid cols-2' }, ...serviceCards),
    h('div', { class: 'section-title' }, 'About'),
    note,
    h('div', { class: 'section-title' }, 'Diagnostics'),
    h('div', { class: 'card', id: 'diag-panel' }, h('div', { class: 'dim' }, 'Loading diagnostics…')),
    h('div', { class: 'section-title' }, 'Custom Links'),
    h('div', { class: 'card', id: 'links-admin' }, h('div', { class: 'dim' }, 'Loading…')),
    (cfg.auth && cfg.auth.plexEnabled) ? h('div', { class: 'section-title' }, 'Login log') : null,
    (cfg.auth && cfg.auth.plexEnabled) ? h('div', { class: 'card', id: 'loginlog-panel' }, h('div', { class: 'dim' }, 'Loading…')) : null,
  );

  hydrateDiagnostics(ctx);
  hydrateLinksAdmin(ctx);
  if (cfg.auth && cfg.auth.plexEnabled) hydrateLoginLog(ctx);
}

async function hydrateLinksAdmin(ctx) {
  const panel = document.getElementById('links-admin');
  if (!panel) return;
  let links = [];
  try { links = await ctx.api.links(); } catch { /* ignore */ }
  const label = h('input', { class: 'input', placeholder: 'Label (e.g. Router)' });
  const url = h('input', { class: 'input', placeholder: 'https://…' });
  const icon = h('input', { class: 'input', placeholder: 'Icon URL (optional)' });
  const add = async () => {
    if (!label.value.trim() || !url.value.trim()) { toast('Label and URL required', 'error'); return; }
    try { await ctx.api.addLink({ label: label.value.trim(), url: url.value.trim(), icon: icon.value.trim() }); toast('Link added', 'success'); hydrateLinksAdmin(ctx); }
    catch (e) { toast(e.message, 'error'); }
  };
  const rows = links.map((l) => h('div', { class: 'setting-row' },
    h('span', {}, h('span', { style: { fontWeight: '700' } }, l.label), h('span', { class: 'dim', style: { marginLeft: '8px' } }, l.url)),
    h('button', { class: 'btn sm danger right', onclick: async () => { try { await ctx.api.removeLink(l.id); hydrateLinksAdmin(ctx); } catch (e) { toast(e.message, 'error'); } } }, 'Remove'),
  ));
  mount(panel,
    h('div', { class: 'pw-form', style: { marginBottom: '12px' } },
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, label, url, icon),
      h('button', { class: 'btn primary sm', style: { alignSelf: 'flex-start' }, onclick: add }, '＋ Add link'),
    ),
    links.length ? h('div', {}, ...rows) : h('div', { class: 'dim' }, 'No links yet.'),
  );
}

async function hydrateLoginLog(ctx) {
  const panel = document.getElementById('loginlog-panel');
  if (!panel) return;
  let log = [];
  try { log = await ctx.api.loginLog(); } catch { /* ignore */ }
  if (!log.length) { mount(panel, h('div', { class: 'dim' }, 'No logins recorded yet.')); return; }
  mount(panel, h('div', { class: 'list', style: { maxHeight: '320px', overflowY: 'auto' } }, ...log.map((e) => h('div', { class: 'row' },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title', style: { fontSize: '14px' } }, e.user),
      h('div', { class: 'meta-line', style: { marginTop: '2px' } },
        h('span', { class: 'dim' }, new Date(e.at).toLocaleString()),
        e.ip ? h('span', { class: 'pill muted' }, e.ip) : null,
      ),
    ),
  ))));
}

function fmtUptime(sec) {
  sec = Math.max(0, Math.round(sec));
  const d = Math.floor(sec / 86400), h2 = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return [d ? `${d}d` : '', h2 ? `${h2}h` : '', m ? `${m}m` : '', `${s}s`].filter(Boolean).join(' ');
}

async function hydrateDiagnostics(ctx) {
  const panel = document.getElementById('diag-panel');
  if (!panel) return;
  let d;
  try { d = await ctx.api.diagnostics(); }
  catch (e) { mount(panel, h('div', { class: 'dim' }, `Diagnostics unavailable: ${e.message}`)); return; }
  const mb = (b) => `${(b / 1048576).toFixed(0)} MB`;
  const s = d.server || {};
  const rows = (d.requests || []).map((r) => h('div', { class: 'row' },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title', style: { fontSize: '13px' } }, `${r.method} ${r.path}`),
      h('div', { class: 'meta-line', style: { marginTop: '2px' } },
        h('span', { class: `pill ${r.status >= 500 ? 'down' : r.status >= 400 ? 'warn' : 'ok'}` }, String(r.status)),
        h('span', {}, `${r.ms}ms`),
        h('span', { class: 'dim' }, new Date(r.t).toLocaleTimeString()),
      ),
    ),
  ));
  mount(panel,
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' } },
      h('h3', { style: { margin: 0 } }, 'Server'),
      h('button', { class: 'btn sm', style: { marginLeft: 'auto' }, onclick: () => hydrateDiagnostics(ctx) }, '↻ Refresh'),
    ),
    settingRow('Uptime', fmtUptime(s.uptime)),
    settingRow('Node', s.node || '—'),
    settingRow('Memory (RSS / heap)', `${mb(s.rss || 0)} / ${mb(s.heapUsed || 0)}`),
    settingRow('Services', String(s.services ?? '—')),
    settingRow('Mode', s.mock ? 'Demo (mock)' : 'Live'),
    h('div', { class: 'section-title', style: { margin: '16px 0 8px' } }, `Recent requests (${rows.length})`),
    rows.length ? h('div', { class: 'list', style: { maxHeight: '360px', overflowY: 'auto' } }, ...rows) : h('div', { class: 'dim' }, 'No recent API requests'),
  );
}

function appearanceCard(root, ctx) {
  const theme = getTheme();
  const accent = getAccent();
  const themeBtn = (val, label) => h('button', {
    class: `btn sm hex-btn ${theme === val ? 'primary' : ''}`,
    onclick: () => { applyTheme(val); renderSettings(root, ctx); },
  }, label);
  const swatches = ACCENT_NAMES.map((name) => h('button', {
    class: `accent-swatch ${accent === name ? 'active' : ''}`,
    title: name,
    style: { background: `linear-gradient(135deg, ${ACCENTS[name][0]}, ${ACCENTS[name][1]})` },
    onclick: () => { applyAccent(name); renderSettings(root, ctx); },
  }));
  const gmode = globalMode();
  const viewBtn = (val, label) => h('button', {
    class: `btn sm hex-btn ${gmode === val ? 'primary' : ''}`,
    onclick: () => { setGlobalMode(val); renderSettings(root, ctx); },
  }, label);
  return h('div', { class: 'card' },
    settingRow('Theme', h('span', { style: { display: 'flex', gap: '8px' } }, themeBtn('light', 'Light'), themeBtn('dark', 'Dark'))),
    settingRow('Accent', h('span', { class: 'accent-row' }, ...swatches)),
    settingRow('Default view', h('span', { style: { display: 'flex', gap: '8px' } }, viewBtn('hex', 'Hexagon'), viewBtn('list', 'List'))),
    h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '8px' } }, 'Each page can override this with its own Hex/List toggle.'),
  );
}

function settingRow(label, value) {
  return h('div', { class: 'setting-row' },
    h('span', { class: 'dim' }, label),
    h('span', { class: 'right' }, value),
  );
}

const SERVICE_TYPE_OPTIONS = ['sonarr', 'radarr', 'overseerr', 'sabnzbd', 'tautulli', 'prowlarr', 'bazarr', 'plex'];

function field(label, control, hint) {
  return h('label', { class: 'pw-field' },
    h('span', { class: 'pw-field-label' }, label),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, control, hint ? h('span', { class: 'dim', style: { fontSize: '11px' } }, hint) : null),
  );
}

// Add or edit a service; writes to config.json via the guarded endpoint.
function openServiceForm(root, ctx, existingKey, existing) {
  const isNew = !existingKey;
  const keyInput = h('input', { class: 'input', value: existingKey || '', placeholder: 'e.g. sonarr4k', disabled: isNew ? null : 'disabled' });
  const label = h('input', { class: 'input', value: (existing && existing.label) || '' });
  const typeSel = h('select', { class: 'input' }, ...SERVICE_TYPE_OPTIONS.map((t) => h('option', { value: t, selected: existing && existing.type === t ? 'selected' : null }, t)));
  const baseUrl = h('input', { class: 'input', placeholder: existing && existing.configured ? '•••• (leave blank to keep)' : 'https://sonarr.example.com' });
  const apiKey = h('input', { class: 'input', type: 'password', placeholder: existing && existing.configured ? '•••• (leave blank to keep)' : 'API key' });
  const cfId = h('input', { class: 'input', placeholder: existing && existing.hasCloudflareAccess ? '•••• (leave blank to keep)' : 'CF-Access-Client-Id (optional)' });
  const cfSecret = h('input', { class: 'input', type: 'password', placeholder: existing && existing.hasCloudflareAccess ? '•••• (leave blank to keep)' : 'CF-Access-Client-Secret (optional)' });
  const enabled = h('input', { type: 'checkbox', checked: (existing ? existing : { }) && (!existing || existing.enabled !== false) ? 'checked' : null });

  const save = async () => {
    const key = (existingKey || keyInput.value || '').trim();
    if (!key || !/^[a-z0-9_-]{1,40}$/i.test(key)) { toast('Enter a valid key (letters, numbers, - or _)', 'error'); return; }
    const service = {
      label: label.value.trim() || key,
      type: typeSel.value,
      enabled: enabled.checked,
      baseUrl: baseUrl.value.trim(),
      apiKey: apiKey.value.trim(),
    };
    if (cfId.value.trim() || cfSecret.value.trim()) service.cloudflareAccess = { clientId: cfId.value.trim(), clientSecret: cfSecret.value.trim() };
    try {
      await ctx.api.saveService(key, service);
      ctx.state.config = await ctx.api.config();
      ctx.state.services = Object.values(ctx.state.config.services || {});
      toast(`Saved ${service.label}`, 'success');
      closeModal();
      ctx.reload();
    } catch (e) { toast(e.message, 'error'); }
  };
  const remove = () => confirmModal({
    title: 'Remove service', message: `Remove "${(existing && existing.label) || existingKey}" from config.json?`, confirmLabel: 'Remove', danger: true,
    onConfirm: async () => {
      try {
        await ctx.api.deleteService(existingKey);
        ctx.state.config = await ctx.api.config();
        ctx.state.services = Object.values(ctx.state.config.services || {});
        toast('Removed', 'success'); closeModal(); ctx.reload();
      } catch (e) { toast(e.message, 'error'); }
    },
  });

  const body = h('div', { class: 'pw-form' },
    field('Key', keyInput, isNew ? 'Unique id used in the URL (#/<key>). Cannot change later.' : 'Fixed'),
    field('Label', label),
    field('Type', typeSel),
    field('URL', baseUrl),
    field('API key', apiKey),
    field('CF Access ID', cfId),
    field('CF Access secret', cfSecret),
    field('Enabled', h('span', { class: 'pw-toggle' }, enabled)),
    h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '4px' } }, 'Saved to config.json on the server. Secrets are never sent back to the browser.'),
  );
  const footer = h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'space-between', width: '100%' } },
    isNew ? h('span', {}) : h('button', { class: 'btn danger sm', onclick: remove }, 'Remove'),
    h('div', { style: { display: 'flex', gap: '10px' } },
      h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: save }, isNew ? 'Add service' : 'Save'),
    ),
  );
  openModal({ title: isNew ? 'Add service' : `Edit ${(existing && existing.label) || existingKey}`, body, footer, wide: true });
}
