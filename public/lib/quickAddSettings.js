// Settings → Quick Add: per-instance defaults (quality profile, root folder,
// monitor, search on add) used by one-tap "+ Add" in global Search, plus which
// instance Movies / TV go to when there's more than one. Changes save
// immediately to the same storage Search reads.
import { h, mount, toast, rootFolderLabel } from './ui.js';
import { instanceOptions, arrInstances } from './quickAdd.js';
import {
  getAddDefaults, setAddDefaults, clearAddDefaults, initialAddChoices, resolveAddDefaults,
  preferredInstance, getPreferredInstanceKey, setPreferredInstanceKey,
} from './addDefaults.js';

const field = (label, control) => h('label', { class: 'quick-add-field' }, h('span', { class: 'quick-add-label' }, label), control);

export function quickAddSettingsCard(state) {
  const card = h('div', { class: 'card quick-add-settings', id: 'quick-add-settings' });
  const groups = [['movie', 'Movies'], ['tv', 'TV shows']].map(([mt, label]) => ({ mt, label, list: arrInstances(state.services, mt) }));
  if (!groups.some((g) => g.list.length)) {
    mount(card, h('div', { class: 'dim' }, 'Add a Sonarr or Radarr service to use Quick Add from Search.'));
    return card;
  }
  const saved = () => toast('Quick Add defaults saved', 'success', 1400);

  const instanceBlock = (svc, mt) => {
    const status = h('span', { class: 'pill muted' }, 'Loading…');
    const body = h('div', { class: 'quick-add-settings-fields' });
    const block = h('div', { class: 'quick-add-settings-instance' },
      h('div', { class: 'quick-add-settings-head' }, h('strong', {}, svc.label), status),
      body);
    (async () => {
      let opts;
      try { opts = await instanceOptions(svc); } catch (e) {
        status.className = 'pill down'; status.textContent = 'Unreachable';
        mount(body, h('div', { class: 'dim' }, e.message || `Couldn't load profiles from ${svc.label}.`));
        return;
      }
      const render = () => {
        const stored = getAddDefaults(svc.key);
        const valid = resolveAddDefaults(stored, opts.profiles, opts.folders);
        const c = initialAddChoices(stored, opts.profiles, opts.folders);
        status.className = `pill ${valid ? 'ok' : 'warn'}`;
        status.textContent = valid ? 'One-tap ready' : (stored ? 'Needs update' : 'Not set — asks on first Add');
        const profileSel = h('select', { class: 'input', 'aria-label': `${svc.label} quality profile` },
          ...opts.profiles.map((p) => h('option', { value: p.id, selected: p.id === c.qualityProfileId ? 'selected' : null }, p.name)));
        const folderSel = h('select', { class: 'input', 'aria-label': `${svc.label} root folder` },
          ...opts.folders.map((f) => h('option', { value: f.path, selected: f.path === c.rootFolderPath ? 'selected' : null }, rootFolderLabel(f))));
        const monitorChk = h('input', { type: 'checkbox', checked: c.monitored ? 'checked' : null });
        const searchChk = h('input', { type: 'checkbox', checked: c.searchOnAdd ? 'checked' : null });
        const save = () => {
          if (!profileSel.value || !folderSel.value) return;
          setAddDefaults(svc.key, { qualityProfileId: Number(profileSel.value), rootFolderPath: folderSel.value, monitored: monitorChk.checked, searchOnAdd: searchChk.checked });
          saved(); render();
        };
        for (const el of [profileSel, folderSel, monitorChk, searchChk]) el.addEventListener('change', save);
        const reset = h('button', { class: 'btn sm', type: 'button', disabled: stored ? null : 'disabled',
          onclick: () => { clearAddDefaults(svc.key); toast(`${svc.label} will ask again on the next Add`, 'info'); render(); } }, 'Reset');
        mount(body,
          opts.profiles.length && opts.folders.length ? null : h('div', { class: 'dim' }, `${svc.label} has no ${opts.profiles.length ? 'root folders' : 'quality profiles'} yet.`),
          field('Quality profile', profileSel),
          field('Root folder', folderSel),
          h('div', { class: 'quick-add-checks' },
            h('label', {}, monitorChk, ' Monitor'),
            h('label', {}, searchChk, ' Search on add')),
          h('div', { class: 'quick-add-buttons' }, reset),
        );
      };
      render();
    })();
    return block;
  };

  const sections = groups.filter((g) => g.list.length).map(({ mt, label, list }) => {
    const target = preferredInstance(list, mt, getPreferredInstanceKey(mt));
    const picker = list.length > 1
      ? field(`Add ${label.toLowerCase()} to`, h('select', {
        class: 'input', 'aria-label': `Quick Add instance for ${mt === 'tv' ? 'TV' : 'Movies'}`,
        onchange: (e) => { setPreferredInstanceKey(mt, e.target.value); saved(); },
      }, ...list.map((s) => h('option', { value: s.key, selected: s.key === target.key ? 'selected' : null }, s.label))))
      : null;
    return h('div', { class: 'quick-add-settings-group' },
      h('h3', {}, label),
      picker,
      ...list.map((svc) => instanceBlock(svc, mt)));
  });

  mount(card,
    h('div', { class: 'dim settings-copy' }, 'Used by + Add in Search. Each instance keeps its own profile and folder; changes save right away.'),
    ...sections);
  return card;
}
