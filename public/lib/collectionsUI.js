// Radarr → System → "Collections": finish trilogies and franchises.
import { h, mount, spinner, empty, toast, openModal, rootFolderLabel } from './ui.js';
import { incomplete, addMissing, posterOf } from './collections.js';
import { roleAllows } from './roleUi.js';
import { getAddDefaults, setAddDefaults } from './addDefaults.js';

export async function openCollections(arr, ctx) {
  const body = h('div', {});
  openModal({ title: `Complete your collections — ${ctx.service.label}`, body, wide: true });
  mount(body, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, spinner(), h('span', { class: 'dim' }, 'Reading collections…')));
  let collections; let profiles; let folders;
  try { [collections, profiles, folders] = await Promise.all([arr.get('collection'), arr.get('qualityprofile'), arr.get('rootfolder')]); }
  catch (e) { mount(body, empty('', 'Couldn’t read collections', e.status === 404 ? 'This Radarr is too old for collections (needs v4.2 or newer).' : e.message)); return; }
  let showUnreleased = false;
  const saved = getAddDefaults(ctx.service.key) || {};
  const profSel = h('select', { class: 'input', style: { width: 'auto' } }, ...profiles.map((p) => h('option', { value: String(p.id), selected: p.id === Number(saved.qualityProfileId) ? 'selected' : null }, p.name)));
  // Remembered folder if it's still there, else the first one that's reachable.
  const defRoot = (folders.find((f) => f.path === saved.rootFolderPath) || folders.find((f) => f.accessible !== false) || folders[0] || {}).path;
  const rootSel = h('select', { class: 'input', style: { width: 'auto' } }, ...folders.map((f) => h('option', { value: f.path, selected: f.path === defRoot ? 'selected' : null }, rootFolderLabel(f))));
  const search = h('input', { type: 'checkbox', role: 'switch', checked: saved.searchOnAdd !== false ? 'checked' : null });
  const canAdd = roleAllows('write');
  const list = h('div', {});
  const add = async (movies, btn) => {
    btn.disabled = true;
    setAddDefaults(ctx.service.key, { qualityProfileId: profSel.value, rootFolderPath: rootSel.value, searchOnAdd: search.checked });
    let ok = 0; const failed = [];
    for (const m of movies) {
      try { await addMissing(arr, m, { qualityProfileId: profSel.value, rootFolderPath: rootSel.value, search: search.checked }); ok += 1; m.isExisting = true; }
      catch (e) { failed.push(`${m.title}: ${e.message}`); }
    }
    toast(failed.length ? `Added ${ok}; ${failed.length} failed (${failed[0]})` : `Added ${ok} ${ok === 1 ? 'film' : 'films'}${search.checked ? ' and started searching' : ''}`, failed.length ? 'warn' : 'success', 6000);
    render();
  };
  function render() {
    const groups = incomplete(collections, { includeUnreleased: showUnreleased });
    if (!groups.length) { mount(list, empty('✓', 'Nothing to complete', 'Every collection you’ve started is complete.')); return; }
    mount(list, h('div', { class: 'list' }, ...groups.map((g) => {
      const allBtn = canAdd ? h('button', { class: 'btn sm primary', onclick: () => add(g.missing, allBtn) }, g.missing.length === 1 ? 'Add it' : `Add all ${g.missing.length}`) : null;
      return h('div', { class: 'row', style: { alignItems: 'flex-start' } },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', style: { fontSize: '14px' } }, g.title, ' ', h('span', { class: 'pill muted' }, `${g.have} of ${g.total}`)),
          h('div', { class: 'dim', style: { fontSize: '12px', margin: '2px 0 6px' } }, `You have ${g.haveTitles.join(', ')}`),
          h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } }, ...g.missing.map((m) => {
            const one = canAdd ? h('button', { class: 'btn sm', onclick: () => add([m], one) }, '+ Add') : null;
            return h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', background: 'var(--surface-2)', borderRadius: '10px', padding: '6px 8px' } },
              posterOf(m) ? h('img', { src: posterOf(m), alt: '', loading: 'lazy', style: { width: '30px', height: '45px', objectFit: 'cover', borderRadius: '4px' } }) : null,
              h('div', { style: { fontSize: '12px' } }, h('b', {}, m.title), h('div', { class: 'dim' }, [m.year, m.status === 'announced' ? 'not out yet' : ''].filter(Boolean).join(' · '))), one);
          }))),
        allBtn ? h('div', { class: 'row-actions' }, allBtn) : null);
    })));
  }
  mount(body,
    h('p', { class: 'dim', style: { margin: '0 0 10px', fontSize: '13px' } }, 'Collections you’ve started but not finished, closest to complete first. Films you’ve excluded in Radarr aren’t suggested.'),
    canAdd ? h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' } }, h('span', { class: 'dim', style: { fontSize: '13px' } }, 'Add with'), profSel, rootSel,
      h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '13px' } }, search, 'Search on add')) : null,
    h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '13px', marginBottom: '10px' } },
      h('input', { type: 'checkbox', role: 'switch', onchange: (e) => { showUnreleased = e.target.checked; render(); } }), 'Include films that aren’t out yet'),
    list);
  render();
}
