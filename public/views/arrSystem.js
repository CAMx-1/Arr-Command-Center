// Shared "System" + "Wanted" tabs for Sonarr/Radarr — health checks, disk space,
// system status, maintenance commands, and the missing/wanted list.
import { h, mount, skeletonList, empty, toast, fmtBytes, pct, timeEl, openModal, closeModal, confirmModal } from '../lib/ui.js';
import { profileSummary, formatSpecSummary, tagUsage, profileRows, applyProfileEdits, applyFormatEdits, moveProfileItem, removeFormatSpec, duplicateFormatSpec } from '../lib/arrProfiles.js';
import { roleAllows } from '../lib/roleUi.js';
import { openPathFix } from '../lib/pathFix.js';
import { openDuplicates } from '../lib/duplicates.js';

const HEALTH_CLS = { error: 'down', warning: 'warn', notice: 'info' };
// Health checks that Fix paths can resolve: missing root folders and items
// whose folder is gone.
export function isPathHealth(check) {
  return /RootFolderCheck|RemovedSeriesCheck|RemovedMovieCheck|MountCheck/i.test((check && check.source) || '')
    || /root folder|missing root|does not exist|is missing/i.test((check && check.message) || '');
}

// ?tool=fixpaths | duplicates opens a tool (used by the command palette).
function openRequestedTool(arr, ctx, kind) {
  const tool = ctx.params && ctx.params.tool;
  if (!tool) return;
  if (ctx.setParams) ctx.setParams({ tool: '' });
  if (tool === 'fixpaths') openPathFix(arr, ctx, kind);
  else if (tool === 'duplicates') openDuplicates(arr, ctx, kind);
}

export async function tabSystem(root, arr, ctx, kind) {
  mount(root, skeletonList());
  try {
    const [health, disks, status, blocklist, tags, profiles, formats] = await Promise.all([
      arr.get('health').catch(() => []),
      arr.get('diskspace').catch(() => []),
      arr.get('system/status').catch(() => ({})),
      arr.get('blocklist?page=1&pageSize=20&sortKey=date&sortDirection=descending').catch(() => ({ records: [] })),
      arr.get('tag/detail').catch(() => arr.get('tag').catch(() => [])),
      arr.get('qualityprofile').catch(() => []),
      arr.get('customformat').catch(() => []),
    ]);
    const reload = () => tabSystem(root, arr, ctx, kind);
    setTimeout(() => openRequestedTool(arr, ctx, kind), 0);
    const run = async (name) => {
      try { await arr.post('command', { name }); toast(`${name} started`, 'success'); }
      catch (e) { toast(e.message, 'error'); }
    };
    const commands = kind === 'series'
      ? [['RssSync', 'RSS Sync'], ['RefreshSeries', 'Refresh all'], ['MissingEpisodeSearch', 'Search missing'], ['Backup', 'Backup']]
      : [['RssSync', 'RSS Sync'], ['RefreshMovie', 'Refresh all'], ['MissingMoviesSearch', 'Search missing'], ['Backup', 'Backup']];

    mount(root,
      h('div', { class: 'section-title' }, 'Maintenance'),
      h('div', { class: 'meta-line', style: { gap: '8px', marginBottom: '16px', flexWrap: 'wrap' } },
        ...commands.map(([name, label]) => h('button', { class: 'btn sm', onclick: () => run(name) }, label)),
        h('button', { class: 'btn sm primary', title: 'Re-point moved libraries to the real disk (e.g. after a Windows → Mac move)', onclick: () => openPathFix(arr, ctx, kind) }, '🛠 Fix paths'),
        h('button', { class: 'btn sm', title: 'Find duplicate entries and choose which to delete', onclick: () => openDuplicates(arr, ctx, kind) }, '🔍 Find duplicates'),
      ),
      h('div', { class: 'section-title' }, 'Health'),
      (health && health.length)
        ? h('div', { class: 'list' }, ...health.map((c) => h('div', { class: 'row' },
            h('div', { class: 'row-main' },
              h('div', { class: 'row-title', style: { fontSize: '14px' } }, c.message || c.source),
              h('div', { class: 'meta-line', style: { marginTop: '4px' } },
                h('span', { class: `pill ${HEALTH_CLS[c.type] || 'muted'}` }, c.type || 'notice'),
                c.source ? h('span', { class: 'dim' }, c.source) : null,
                c.wikiUrl ? h('a', { class: 'btn sm', href: c.wikiUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Info') : null,
                isPathHealth(c) ? h('button', { class: 'btn sm primary', onclick: () => openPathFix(arr, ctx, kind) }, '🛠 Fix paths') : null,
              ),
            ),
          )))
        : h('div', { class: 'dim', style: { marginBottom: '16px' } }, 'No health issues — all good.'),
      h('div', { class: 'section-title', style: { marginTop: '16px' } }, 'Disk space'),
      h('div', { class: 'list' }, ...(disks || []).map((d) => {
        const used = (d.totalSpace || 0) - (d.freeSpace || 0);
        const p = d.totalSpace ? (used / d.totalSpace) * 100 : 0;
        return h('div', { class: 'row' },
          h('div', { class: 'row-main' },
            h('div', { class: 'row-title', style: { fontSize: '14px' } }, d.path || d.label || 'Disk'),
            h('div', { class: 'meta-line', style: { marginTop: '4px' } },
              h('span', {}, `${fmtBytes(d.freeSpace)} free of ${fmtBytes(d.totalSpace)}`),
              h('span', { class: `pill ${p > 90 ? 'down' : p > 75 ? 'warn' : 'ok'}` }, `${Math.round(p)}% used`),
            ),
            h('div', { class: 'progress' }, h('span', { style: { width: pct(p) } })),
          ),
        );
      })),
      h('div', { class: 'section-title', style: { marginTop: '16px' } }, 'System'),
      h('div', { class: 'card' },
        infoRow('Version', status.version || '—'),
        infoRow('App', status.appName || (kind === 'series' ? 'Sonarr' : 'Radarr')),
        infoRow('OS', status.osName ? `${status.osName} ${status.osVersion || ''}`.trim() : '—'),
        infoRow('Runtime', status.runtimeVersion ? `${status.runtimeName || ''} ${status.runtimeVersion}`.trim() : '—'),
        infoRow('Docker', status.isDocker ? 'Yes' : 'No'),
      ),
      h('div', { class: 'section-title', style: { marginTop: '16px' } }, 'Blocklist'),
      blocklistSection(blocklist, arr, reload),
      h('div', { class: 'section-title', style: { marginTop: '16px' } }, 'Tags'),
      tagsSection(tags, arr, reload, kind),
      h('div', { class: 'section-title', style: { marginTop: '16px' } }, 'Quality profiles'),
      profilesSection(profiles, formats, arr, reload),
      h('div', { class: 'section-title', style: { marginTop: '16px' } }, 'Custom formats'),
      formatsSection(formats, profiles, arr, reload),
    );
  } catch (err) {
    mount(root, empty('', 'Failed to load system info', err.message, { label: 'Retry', onClick: () => tabSystem(root, arr, ctx, kind) }));
  }
}

// Custom format editor: name, rename flag, and each condition's value,
// negate and required.
function editFormat(original, arr, reload) {
  let format = JSON.parse(JSON.stringify(original));
  const name = h('input', { class: 'input', value: format.name || '' });
  const rename = h('input', { type: 'checkbox', checked: format.includeCustomFormatWhenRenaming ? 'checked' : null });
  let specs = {};
  const specList = h('div', { class: 'list' });
  // Apply pending edits before a structural change so nothing typed is lost.
  const restructure = (fn) => {
    try { format = fn(applyFormatEdits(format, { specs })); } catch (e) { toast(e.message, 'error'); return; }
    specs = {};
    paintSpecs();
  };
  const paintSpecs = () => mount(specList, ...(format.specifications || []).map((sp, i) => {
    const value = (sp.fields || []).find((f) => f && f.name === 'value');
    const valueInput = value ? h('input', { class: 'input mono', value: value.value == null ? '' : String(value.value), spellcheck: 'false', autocapitalize: 'off' }) : null;
    const negate = h('input', { type: 'checkbox', checked: sp.negate ? 'checked' : null });
    const required = h('input', { type: 'checkbox', checked: sp.required ? 'checked' : null });
    const sync = () => { specs[i] = { negate: negate.checked, required: required.checked, ...(valueInput ? { value: valueInput.value } : {}) }; };
    [negate, required].forEach((el) => el.addEventListener('change', sync));
    if (valueInput) valueInput.addEventListener('input', sync);
    return h('div', { class: 'row', style: { flexDirection: 'column', alignItems: 'stretch', gap: '6px' } },
      h('div', { class: 'row-title', style: { fontSize: '13px' } }, formatSpecSummary({ ...sp, negate: false, required: false }).label),
      valueInput,
      h('div', { class: 'meta-line' }, h('label', {}, negate, ' Negate'), h('label', {}, required, ' Required'),
        h('span', { style: { marginLeft: 'auto', display: 'flex', gap: '6px' } },
          h('button', { class: 'btn sm', type: 'button', onclick: () => restructure((f) => duplicateFormatSpec(f, i)) }, 'Duplicate'),
          h('button', { class: 'btn sm danger confirm-btn', type: 'button', disabled: (format.specifications || []).length <= 1 ? 'disabled' : null, onclick: () => restructure((f) => removeFormatSpec(f, i)) }, 'Remove'))));
  }));
  paintSpecs();
  const save = async (btn) => {
    let next;
    try { next = applyFormatEdits(format, { name: name.value, includeCustomFormatWhenRenaming: rename.checked, specs }); }
    catch (e) { toast(e.message, 'error'); return; }
    btn.disabled = true;
    try { await arr.put(`customformat/${format.id}`, next); toast(`Saved ${next.name}`, 'success'); closeModal(); reload(); }
    catch (e) { toast(e.message, 'error'); btn.disabled = false; }
  };
  const saveBtn = h('button', { class: 'btn primary', onclick: () => save(saveBtn) }, 'Save');
  openModal({
    title: `Edit ${format.name}`, wide: true,
    body: h('div', { class: 'pw-form' },
      h('label', { class: 'pw-field' }, h('span', { class: 'pw-field-label' }, 'Name'), name),
      h('label', { class: 'pw-field' }, h('span', { class: 'pw-field-label' }, 'Include in renaming'), h('span', { class: 'pw-toggle' }, rename)),
      h('div', { class: 'section-title', style: { margin: '12px 0 6px' } }, 'Conditions'),
      specList,
      h('p', { class: 'dim settings-copy' }, 'Values are .NET regular expressions where the condition matches text; Sonarr/Radarr check them when you save. Duplicate a condition to make a new one of the same kind.')),
    footer: h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', width: '100%' } }, h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), saveBtn),
  });
}

function infoRow(label, value) {
  return h('div', { class: 'setting-row' }, h('span', { class: 'dim' }, label), h('span', { class: 'right' }, value));
}

// Blocklist: newest first, 20 at a time with "Load more", per-item remove
// and "Clear all" (bulk delete of every entry).
function blocklistSection(first, arr, reload) {
  const wrap = h('div', {});
  let records = [...((first && first.records) || [])];
  let total = (first && first.totalRecords) || records.length;
  let page = 1;
  const row = (b) => h('div', { class: 'row' },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title', style: { fontSize: '13px', wordBreak: 'break-all' } }, b.sourceTitle || 'Unknown'),
      h('div', { class: 'meta-line', style: { marginTop: '2px' } },
        b.protocol ? h('span', { class: 'pill muted' }, b.protocol) : null,
        b.quality && b.quality.quality ? h('span', { class: 'pill info' }, b.quality.quality.name) : null,
        b.indexer ? h('span', {}, b.indexer) : null,
        b.date ? timeEl(b.date) : null,
        b.message ? h('span', { class: 'dim' }, b.message) : null,
      ),
    ),
    h('div', { class: 'row-actions' }, h('button', { class: 'btn sm danger', title: 'Allow this release to be grabbed again', onclick: async () => {
      try { await arr.del(`blocklist/${b.id}`); records = records.filter((x) => x.id !== b.id); total -= 1; paint(); toast('Removed from blocklist', 'success'); }
      catch (e) { toast(e.message, 'error'); }
    } }, 'Remove')),
  );
  const more = async (btn) => {
    btn.disabled = true;
    try {
      const next = await arr.get(`blocklist?page=${page + 1}&pageSize=20&sortKey=date&sortDirection=descending`);
      page += 1; records = records.concat(next.records || []); total = next.totalRecords ?? total; paint();
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
  };
  const clearAll = () => confirmModal({
    title: 'Clear blocklist', message: `Remove all ${total} blocklisted releases? They can be grabbed again.`, confirmLabel: 'Clear all', danger: true,
    onConfirm: async () => {
      try {
        const all = await arr.get(`blocklist?page=1&pageSize=${Math.max(total, 1)}`);
        const ids = (all.records || []).map((b) => b.id);
        if (ids.length) await arr.del('blocklist/bulk', { ids });
        toast(`Cleared ${ids.length} blocklist entr${ids.length === 1 ? 'y' : 'ies'}`, 'success');
        reload();
      } catch (e) { toast(e.message, 'error'); }
    },
  });
  function paint() {
    if (!records.length) { mount(wrap, h('div', { class: 'dim' }, 'Blocklist is empty.')); return; }
    const moreBtn = records.length < total ? h('button', { class: 'btn sm', onclick: (e) => more(e.currentTarget) }, `Load more (${total - records.length} left)`) : null;
    mount(wrap,
      h('div', { class: 'meta-line', style: { marginBottom: '8px' } }, h('span', { class: 'dim' }, `${total} blocklisted`), h('button', { class: 'btn sm danger', onclick: clearAll }, 'Clear all')),
      h('div', { class: 'list' }, ...records.map(row)),
      moreBtn ? h('div', { style: { marginTop: '8px' } }, moreBtn) : null);
  }
  paint();
  return wrap;
}

// Quality profiles (read-only): allowed qualities, cutoff, upgrades and the
// custom format scores. Tap a profile for the full breakdown.
function profilesSection(profiles, formats, arr, reload) {
  const list = profiles || [];
  if (!list.length) return h('div', { class: 'dim' }, 'No quality profiles.');
  return h('div', { class: 'list' }, ...list.map((p) => {
    const sum = profileSummary(p, formats);
    return h('div', { class: 'row clickable', role: 'button', tabindex: '0', onclick: () => openProfile(sum, p, formats, arr, reload) },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title', style: { fontSize: '14px' } }, p.name),
        h('div', { class: 'meta-line', style: { marginTop: '2px' } },
          h('span', { class: 'pill info' }, `${sum.qualities.length} qualities`),
          sum.cutoff ? h('span', {}, `Cutoff: ${sum.cutoff}`) : null,
          h('span', { class: `pill ${sum.upgradeAllowed ? 'ok' : 'muted'}` }, sum.upgradeAllowed ? 'Upgrades on' : 'No upgrades'),
          sum.scored.length ? h('span', { class: 'dim' }, `${sum.scored.length} scored formats`) : null,
        ),
      ),
    );
  }));
}

function openProfile(sum, profile, formats, arr, reload) {
  const canEdit = roleAllows('admin');
  const sec = (t) => h('div', { class: 'section-title', style: { margin: '14px 0 6px' } }, t);
  openModal({
    title: sum.name,
    body: h('div', {},
      infoRow('Upgrades', sum.upgradeAllowed ? 'Allowed' : 'Off'),
      infoRow('Upgrade until', sum.cutoff || '—'),
      infoRow('Minimum format score', String(sum.minFormatScore)),
      infoRow('Upgrade until format score', String(sum.cutoffFormatScore)),
      sec('Allowed qualities (best first)'),
      h('div', { class: 'meta-line', style: { flexWrap: 'wrap', gap: '6px' } }, ...sum.qualities.map((name) => h('span', { class: `pill ${name === sum.cutoff ? 'ok' : 'muted'}` }, name))),
      sec('Custom format scores'),
      sum.scored.length
        ? h('div', { class: 'list' }, ...sum.scored.map((f) => h('div', { class: 'row' }, h('div', { class: 'row-main' }, h('div', { class: 'row-title', style: { fontSize: '13px' } }, f.name)), h('span', { class: `pill ${f.score > 0 ? 'ok' : 'down'}` }, f.score > 0 ? `+${f.score}` : String(f.score)))))
        : h('div', { class: 'dim' }, 'No custom formats are scored in this profile.'),
      canEdit ? null : h('p', { class: 'dim settings-copy' }, 'Only admins can edit profiles.')),
    footer: h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', width: '100%' } },
      h('button', { class: 'btn', onclick: closeModal }, 'Close'),
      canEdit ? h('button', { class: 'btn primary', onclick: () => editProfile(profile, formats, arr, reload) }, 'Edit') : null),
  });
}

// Profile editor: name, upgrades, allowed qualities, cutoff, format scores.
function editProfile(original, formats, arr, reload) {
  // Reordering works on a working copy; allowed ticks are applied to it as
  // they change so moves keep them.
  let profile = JSON.parse(JSON.stringify(original));
  let rows = profileRows(profile);
  const allowed = {};
  const name = h('input', { class: 'input', value: profile.name || '' });
  const upgrades = h('input', { type: 'checkbox', checked: profile.upgradeAllowed ? 'checked' : null });
  const cutoff = h('select', { class: 'input' });
  const paintCutoff = () => {
    const current = Number(cutoff.value || profile.cutoff);
    mount(cutoff, ...rows.filter((r) => (allowed[r.index] ?? r.allowed)).map((r) => h('option', { value: String(r.cutoffId), selected: r.cutoffId === current ? 'selected' : null }, r.name)));
  };
  const qualityList = h('div', { class: 'list' });
  const move = (rowIdx, delta) => {
    profile = applyProfileEdits(profile, { allowed });
    for (const k of Object.keys(allowed)) delete allowed[k];
    profile = moveProfileItem(profile, rowIdx, delta);
    rows = profileRows(profile);
    paintRows();
    const btns = [...qualityList.querySelectorAll(`[data-row="${rowIdx + delta}"] button`)];
    const want = btns[delta < 0 ? 0 : 1];
    (want && !want.disabled ? want : btns.find((b) => !b.disabled))?.focus();
  };
  function paintRows() {
    mount(qualityList, ...rows.map((r, i) => {
      const box = h('input', { type: 'checkbox', checked: (allowed[r.index] ?? r.allowed) ? 'checked' : null, 'aria-label': `Allow ${r.name}` });
      box.addEventListener('change', () => { allowed[r.index] = box.checked; paintCutoff(); });
      return h('div', { class: 'row', dataset: { row: String(i) } },
        h('label', { style: { display: 'flex', gap: '10px', alignItems: 'center', flex: '1', cursor: 'pointer' } }, box, h('span', { class: 'row-title', style: { fontSize: '13px' } }, r.name, r.group ? h('span', { class: 'pill muted', style: { marginLeft: '6px' } }, 'group') : null)),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn sm', type: 'button', disabled: i === 0 ? 'disabled' : null, 'aria-label': `Move ${r.name} up`, onclick: () => move(i, -1) }, '↑'),
          h('button', { class: 'btn sm', type: 'button', disabled: i === rows.length - 1 ? 'disabled' : null, 'aria-label': `Move ${r.name} down`, onclick: () => move(i, 1) }, '↓')));
    }));
    paintCutoff();
  }
  paintRows();
  const num = (v) => h('input', { class: 'input', type: 'number', step: '1', value: String(v ?? 0), style: { maxWidth: '120px' } });
  const minScore = num(profile.minFormatScore);
  const cutoffScore = num(profile.cutoffFormatScore);
  const minUpgrade = num(profile.minUpgradeFormatScore ?? 1);
  const scoreInputs = (formats || []).map((f) => {
    const fi = (profile.formatItems || []).find((x) => x.format === f.id);
    return [f, num(fi ? fi.score : 0)];
  });
  const field = (label, control) => h('label', { class: 'pw-field' }, h('span', { class: 'pw-field-label' }, label), control);
  const save = async (btn) => {
    let next;
    try {
      next = applyProfileEdits(profile, {
        name: name.value, upgradeAllowed: upgrades.checked, allowed, cutoff: cutoff.value,
        minFormatScore: minScore.value, cutoffFormatScore: cutoffScore.value, minUpgradeFormatScore: minUpgrade.value,
        scores: Object.fromEntries(scoreInputs.map(([f, input]) => [f.id, input.value])),
      });
    } catch (e) { toast(e.message, 'error'); return; }
    btn.disabled = true;
    try { await arr.put(`qualityprofile/${profile.id}`, next); toast(`Saved ${next.name}`, 'success'); closeModal(); reload(); }
    catch (e) { toast(e.message, 'error'); btn.disabled = false; }
  };
  const saveBtn = h('button', { class: 'btn primary', onclick: () => save(saveBtn) }, 'Save');
  openModal({
    title: `Edit ${profile.name}`, wide: true,
    body: h('div', { class: 'pw-form' },
      field('Name', name),
      field('Upgrades allowed', h('span', { class: 'pw-toggle' }, upgrades)),
      field('Upgrade until', cutoff),
      h('div', { class: 'section-title', style: { margin: '12px 0 6px' } }, 'Allowed qualities (best first)'),
      qualityList,
      h('div', { class: 'section-title', style: { margin: '12px 0 6px' } }, 'Custom format scores'),
      field('Minimum format score', minScore),
      field('Upgrade until format score', cutoffScore),
      field('Minimum score increment', minUpgrade),
      ...scoreInputs.map(([f, input]) => field(f.name, input)),
      h('p', { class: 'dim settings-copy' }, 'Higher in the list is preferred. Grouping qualities still happens in Sonarr/Radarr.')),
    footer: h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', width: '100%' } }, h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), saveBtn),
  });
}

function formatsSection(formats, profiles, arr, reload) {
  const canEdit = roleAllows('admin');
  const list = formats || [];
  if (!list.length) return h('div', { class: 'dim' }, 'No custom formats.');
  return h('div', { class: 'list' }, ...list.map((f) => {
    const usedBy = (profiles || []).filter((p) => (p.formatItems || []).some((fi) => fi.format === f.id && fi.score)).map((p) => {
      const score = p.formatItems.find((fi) => fi.format === f.id).score;
      return `${p.name} ${score > 0 ? '+' : ''}${score}`;
    });
    return h('div', { class: 'row' },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title', style: { fontSize: '14px' } }, f.name),
        h('div', { class: 'meta-line', style: { marginTop: '2px', flexWrap: 'wrap' } },
          ...(f.specifications || []).map((sp) => h('span', { class: 'pill muted', title: formatSpecSummary(sp).detail }, formatSpecSummary(sp).label)),
          usedBy.length ? h('span', { class: 'dim' }, `Scored in: ${usedBy.join(', ')}`) : h('span', { class: 'dim' }, 'Not scored in any profile'),
        ),
      ),
      canEdit ? h('div', { class: 'row-actions' }, h('button', { class: 'btn sm', onclick: () => editFormat(f, arr, reload) }, 'Edit')) : null,
    );
  }));
}

// Tags with usage counts. Rename and delete are admin actions in Sonarr/Radarr
// terms (they change every item using the tag); per-item tags are edited from
// an item's Edit screen or in bulk from the library.
function tagsSection(tags, arr, reload, kind) {
  const list = tagUsage(tags, kind);
  const input = h('input', { class: 'input', placeholder: 'New tag label', style: { maxWidth: '220px' } });
  const add = async () => {
    if (!input.value.trim()) return;
    try { await arr.post('tag', { label: input.value.trim() }); toast('Tag added', 'success'); reload(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const rename = (t) => {
    const field = h('input', { class: 'input', value: t.label });
    const save = async () => {
      const label = field.value.trim();
      if (!label || label === t.label) { closeModal(); return; }
      try { await arr.put(`tag/${t.id}`, { id: t.id, label }); toast('Tag renamed', 'success'); closeModal(); reload(); }
      catch (e) { toast(e.message, 'error'); }
    };
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    openModal({ title: `Rename “${t.label}”`, body: h('div', {}, field, h('p', { class: 'dim settings-copy' }, t.total ? `Used by ${t.summary}.` : 'Not used yet.')),
      footer: h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', width: '100%' } }, h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn primary', onclick: save }, 'Rename')) });
  };
  const remove = (t) => confirmModal({
    title: 'Delete tag', message: t.total ? `“${t.label}” is used by ${t.summary}. Deleting it removes it from all of them.` : `Delete “${t.label}”?`, confirmLabel: 'Delete', danger: true,
    onConfirm: async () => { try { await arr.del(`tag/${t.id}`); toast('Tag deleted', 'success'); reload(); } catch (e) { toast(e.message, 'error'); } },
  });
  return h('div', {},
    list.length ? h('div', { class: 'list', style: { marginBottom: '10px' } }, ...list.map((t) => h('div', { class: 'row' },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title', style: { fontSize: '14px' } }, t.label),
        h('div', { class: 'meta-line', style: { marginTop: '2px' } }, h('span', { class: 'dim' }, t.total ? `Used by ${t.summary}` : 'Unused'))),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn sm', onclick: () => rename(t) }, 'Rename'),
        h('button', { class: 'btn sm danger', onclick: () => remove(t) }, 'Delete')),
    ))) : h('div', { class: 'dim', style: { marginBottom: '10px' } }, 'No tags'),
    h('div', { class: 'meta-line', style: { gap: '8px' } }, input, h('button', { class: 'btn sm', onclick: add }, 'Add tag')),
  );
}

export async function tabWanted(root, arr, ctx, kind, mode = 'missing') {
  mount(root, skeletonList());
  try {
    const inc = kind === 'series' ? 'includeSeries=true' : 'includeMovie=true';
    const endpoint = mode === 'cutoff' ? 'wanted/cutoff' : 'wanted/missing';
    const data = await arr.get(`${endpoint}?page=1&pageSize=50&sortDirection=descending&${inc}`);
    const records = (data && data.records) || [];
    const seg = (m, label) => h('button', { class: `view-seg ${mode === m ? 'active' : ''}`, onclick: () => { if (mode !== m) tabWanted(root, arr, ctx, kind, m); } }, label);
    const toggle = h('div', { class: 'view-toggle wanted-toggle', role: 'group', 'aria-label': 'Wanted list' }, seg('missing', 'Missing'), seg('cutoff', 'Cutoff Unmet'));
    const cmd = kind === 'series'
      ? (mode === 'cutoff' ? 'CutoffUnmetEpisodeSearch' : 'MissingEpisodeSearch')
      : (mode === 'cutoff' ? 'CutoffUnmetMoviesSearch' : 'MissingMoviesSearch');
    const searchAll = h('button', { class: 'btn sm primary', title: 'Search all ' + (mode === 'cutoff' ? 'cutoff-unmet' : 'missing') + ' items', onclick: async () => {
      try { await arr.post('command', { name: cmd }); toast(`Searching all ${mode === 'cutoff' ? 'cutoff-unmet' : 'missing'} items…`, 'success'); }
      catch (e) { toast(e.message, 'error'); }
    } }, 'Search all');
    const head = h('div', { class: 'lib-head', style: { justifyContent: 'space-between', marginBottom: '12px' } }, toggle, searchAll);
    if (!records.length) return mount(root, head, empty('', mode === 'cutoff' ? 'Nothing below cutoff' : 'Nothing missing', 'Everything monitored is satisfied.'));
    mount(root, head, h('div', { class: 'list' }, ...records.map((r) => wantedRow(r, arr, kind))));
  } catch (err) {
    mount(root, empty('', 'Failed to load wanted', err.message, { label: 'Retry', onClick: () => tabWanted(root, arr, ctx, kind, mode) }));
  }
}

function wantedRow(r, arr, kind) {
  const isSeries = kind === 'series';
  const title = isSeries
    ? `${(r.series && r.series.title) || 'Unknown'} · S${String(r.seasonNumber ?? 0).padStart(2, '0')}E${String(r.episodeNumber ?? 0).padStart(2, '0')}`
    : `${r.title || 'Unknown'}${r.year ? ` (${r.year})` : ''}`;
  const search = async () => {
    try {
      if (isSeries) await arr.post('command', { name: 'EpisodeSearch', episodeIds: [r.id] });
      else await arr.post('command', { name: 'MoviesSearch', movieIds: [r.id] });
      toast('Searching…', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };
  return h('div', { class: 'row' },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title', style: { fontSize: '14px' } }, isSeries ? title : `${r.title || 'Unknown'}`, isSeries ? null : h('span', { class: 'dim' }, r.year ? ` (${r.year})` : '')),
      h('div', { class: 'meta-line', style: { marginTop: '4px' } },
        isSeries && r.title ? h('span', { class: 'dim' }, r.title) : null,
        (isSeries ? r.airDateUtc : (r.inCinemas || r.digitalRelease)) ? timeEl(isSeries ? r.airDateUtc : (r.digitalRelease || r.inCinemas)) : null,
      ),
    ),
    h('div', { class: 'row-actions' }, h('button', { class: 'btn sm', onclick: search }, 'Search')),
  );
}
