// One-tap Add for global Search: "+ Add" sends a title straight to Sonarr or
// Radarr using that instance's remembered quality profile and root folder,
// behind a 5-second Undo toast. "⋯" expands an inline options panel (instance,
// profile, folder, monitor, search) that also sets those defaults. The first
// Add on an instance opens the panel, since there's nothing remembered yet.
import { api } from './api.js';
import { h, mount, clear, toast, rootFolderLabel } from './ui.js';
import { cachedGet, invalidate } from './cache.js';
import { toastWithUndo } from './queueActions.js';
import {
  getAddDefaults, setAddDefaults, resolveAddDefaults, initialAddChoices,
  preferredInstance, getPreferredInstanceKey, setPreferredInstanceKey, buildAddPayload,
} from './addDefaults.js';

export function arrInstances(services, mediaType) {
  const type = mediaType === 'tv' ? 'sonarr' : 'radarr';
  return (services || []).filter((s) => s.type === type && s.configured !== false);
}

export async function instanceOptions(svc) {
  const arr = api.arr(svc.key);
  const [profiles, folders] = await Promise.all([
    cachedGet(`arr:${svc.key}:qualityprofile`, () => arr.get('qualityprofile'), 600000),
    cachedGet(`arr:${svc.key}:rootfolder`, () => arr.get('rootfolder'), 600000),
  ]);
  return { profiles: profiles || [], folders: folders || [] };
}

// Resolve a Seerr (TMDB) search result to the instance's own lookup object,
// which is what Sonarr/Radarr expect in the add request.
export function seerrResolver(seerrSvc, r) {
  return async (svc) => {
    const arr = api.arr(svc.key);
    if (r.mediaType === 'tv') {
      let tvdbId = null;
      try { const d = await api.seerr(seerrSvc.key).get(`tv/${r.id}`); tvdbId = d?.externalIds?.tvdbId || null; } catch { /* fall back to title */ }
      const title = r.name || r.title || '';
      const list = await arr.get(`series/lookup?term=${encodeURIComponent(tvdbId ? `tvdb:${tvdbId}` : title)}`);
      const year = (r.firstAirDate || '').slice(0, 4);
      return (list || []).find((x) => (tvdbId ? x.tvdbId === tvdbId : String(x.year) === year)) || (list || [])[0] || null;
    }
    const list = await arr.get(`movie/lookup?term=${encodeURIComponent(`tmdb:${r.id}`)}`);
    return (list || []).find((x) => x.tmdbId === r.id) || (list || [])[0] || null;
  };
}

// Resolve by known ids (no Seerr needed): movies by tmdb:<id>; series by
// tvdb:<id> when known, else by title (+ year) — Sonarr looks series up by TVDB.
export function idResolver({ mediaType, tmdbId, tvdbId, title, year }) {
  return async (svc) => {
    const arr = api.arr(svc.key);
    if (mediaType === 'tv') {
      const list = await arr.get(`series/lookup?term=${encodeURIComponent(tvdbId ? `tvdb:${tvdbId}` : title)}`);
      return (list || []).find((x) => (tvdbId ? x.tvdbId === tvdbId : tmdbId && x.tmdbId === tmdbId))
        || (list || []).find((x) => !year || String(x.year) === String(year))
        || (list || [])[0] || null;
    }
    const list = await arr.get(`movie/lookup?term=${encodeURIComponent(`tmdb:${tmdbId}`)}`);
    return (list || []).find((x) => x.tmdbId === tmdbId) || (list || [])[0] || null;
  };
}

// Returns { actions, panel } for a search result row. `resolveItem(svc)`
// returns the lookup object for that instance. `extraActions` are extra
// buttons shown in the options panel (e.g. "Request via Seerr…").
export function quickAddControls({ services, mediaType, title, resolveItem, extraActions = [] }) {
  const instances = arrInstances(services, mediaType);
  const target = () => preferredInstance(instances, mediaType, getPreferredInstanceKey(mediaType));
  const kind = mediaType === 'tv' ? 'series' : 'movie';
  let busy = false;
  let open = false;

  const addBtn = h('button', { class: 'btn sm primary quick-add-btn', type: 'button', onclick: () => oneTap() }, '+ Add');
  const moreBtn = h('button', { class: 'btn sm quick-add-more', type: 'button', title: 'Add options', 'aria-expanded': 'false', onclick: () => togglePanel() }, '⋯');
  const panel = h('div', { class: 'quick-add-panel', hidden: true });

  const setBtn = (label, { disabled = false, done = false } = {}) => {
    addBtn.textContent = label; addBtn.disabled = disabled;
    addBtn.classList.toggle('quick-add-done', done);
  };

  // Queue the add behind an Undo toast; nothing is sent until it expires.
  const commit = (svc, choice, profileName) => {
    busy = true;
    setBtn('Adding…', { disabled: true });
    const where = [svc.label, profileName].filter(Boolean).join(' · ');
    toastWithUndo(`Adding ${title} to ${where}`, {
      onUndo: () => { busy = false; setBtn('+ Add'); },
      run: async () => {
        try {
          const item = await resolveItem(svc);
          if (!item) throw new Error(`${svc.label} couldn't find “${title}”`);
          await api.arr(svc.key).post(kind, buildAddPayload(mediaType, item, choice));
          invalidate(`arr:${svc.key}:${kind}`);
          setBtn('✓ Added', { disabled: true, done: true });
          moreBtn.hidden = true; closePanel();
          toast(`Added ${title} to ${svc.label}`, 'success');
        } catch (e) {
          busy = false; setBtn('+ Add');
          toast(e.message || `Couldn't add ${title}`, 'error');
        }
      },
    });
  };

  async function oneTap() {
    if (busy) return;
    const svc = target();
    if (!svc) return;
    let opts;
    try { opts = await instanceOptions(svc); } catch (e) { toast(e.message || `Couldn't reach ${svc.label}`, 'error'); return; }
    const choice = resolveAddDefaults(getAddDefaults(svc.key), opts.profiles, opts.folders);
    if (!choice) { openPanel({ firstTime: true }); return; }
    commit(svc, choice, choice.profileName);
  }

  function closePanel() { open = false; panel.hidden = true; clear(panel); moreBtn.setAttribute('aria-expanded', 'false'); }
  function togglePanel() { if (open) closePanel(); else openPanel(); }

  async function openPanel({ firstTime = false } = {}) {
    open = true; panel.hidden = false; moreBtn.setAttribute('aria-expanded', 'true');
    let svc = target();
    const instSel = instances.length > 1
      ? h('select', { class: 'input', 'aria-label': 'Instance', onchange: () => { svc = instances.find((s) => s.key === instSel.value) || svc; fill(); } },
        ...instances.map((s) => h('option', { value: s.key, selected: s.key === svc.key ? 'selected' : null }, s.label)))
      : null;
    const profileSel = h('select', { class: 'input', 'aria-label': 'Quality profile' });
    const folderSel = h('select', { class: 'input', 'aria-label': 'Root folder' });
    const monitorChk = h('input', { type: 'checkbox' });
    const searchChk = h('input', { type: 'checkbox' });
    const go = h('button', { class: 'btn sm primary', type: 'button', onclick: async () => {
      if (busy || !profileSel.value || !folderSel.value) return;
      const choice = { qualityProfileId: Number(profileSel.value), rootFolderPath: folderSel.value, monitored: monitorChk.checked, searchOnAdd: searchChk.checked };
      setAddDefaults(svc.key, choice);
      setPreferredInstanceKey(mediaType, svc.key);
      closePanel();
      commit(svc, choice, profileSel.selectedOptions[0]?.textContent || '');
    } }, `Add to ${svc ? svc.label : ''}`);
    const field = (label, control) => h('label', { class: 'quick-add-field' }, h('span', { class: 'quick-add-label' }, label), control);

    async function fill() {
      go.textContent = `Add to ${svc.label}`;
      go.disabled = true;
      mount(profileSel, h('option', {}, 'Loading…')); mount(folderSel, h('option', {}, 'Loading…'));
      let opts;
      try { opts = await instanceOptions(svc); } catch (e) { toast(e.message || `Couldn't reach ${svc.label}`, 'error'); return; }
      const c = initialAddChoices(getAddDefaults(svc.key), opts.profiles, opts.folders);
      mount(profileSel, ...opts.profiles.map((p) => h('option', { value: p.id, selected: p.id === c.qualityProfileId ? 'selected' : null }, p.name)));
      mount(folderSel, ...opts.folders.map((f) => h('option', { value: f.path, selected: f.path === c.rootFolderPath ? 'selected' : null }, rootFolderLabel(f))));
      monitorChk.checked = c.monitored; searchChk.checked = c.searchOnAdd;
      go.disabled = !opts.profiles.length || !opts.folders.length;
    }

    mount(panel,
      firstTime ? h('div', { class: 'quick-add-hint' }, 'Pick your defaults once. After that, + Add is one tap.') : null,
      instSel ? field('Instance', instSel) : null,
      field('Quality profile', profileSel),
      field('Root folder', folderSel),
      h('div', { class: 'quick-add-checks' },
        h('label', {}, monitorChk, ' Monitor'),
        h('label', {}, searchChk, ' Search on add')),
      h('div', { class: 'quick-add-buttons' }, go, ...extraActions),
      firstTime ? null : h('div', { class: 'quick-add-hint dim' }, 'These become the defaults for + Add.'),
    );
    await fill();
  }

  return { actions: instances.length ? [addBtn, moreBtn] : [], panel, available: instances.length > 0 };
}
