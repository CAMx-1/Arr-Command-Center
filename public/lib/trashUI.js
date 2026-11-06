// "Sync from TRaSH Guides" dialog (System tab, admins).
import { h, mount, spinner, empty, toast, openModal, closeModal } from './ui.js';
import { loadTrashProfiles, previewTrashSync, applyTrashSync } from './trashSync.js';

export async function openTrashSync(arr, ctx, kind, onDone = () => {}) {
  const app = kind === 'series' ? 'sonarr' : 'radarr';
  const body = h('div', {}, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, spinner(), h('span', { class: 'dim' }, 'Loading TRaSH Guides profiles…')));
  openModal({ title: `Sync from TRaSH Guides — ${ctx.service.label}`, body, wide: true });
  let trashProfiles; let arrProfiles;
  try { [trashProfiles, arrProfiles] = await Promise.all([loadTrashProfiles(app), arr.get('qualityprofile')]); }
  catch (e) { mount(body, empty('', 'Couldn’t load TRaSH Guides', e.message)); return; }

  const trashSel = h('select', { class: 'input', 'aria-label': 'TRaSH profile' },
    ...trashProfiles.map((p) => h('option', { value: p.slug }, `${p.name} (${p.formats} formats)`)));
  const targetSel = h('select', { class: 'input', 'aria-label': 'Apply scores to' },
    h('option', { value: '' }, 'Don’t change any quality profile (formats only)'),
    ...(arrProfiles || []).map((p) => h('option', { value: String(p.id) }, `Set scores on “${p.name}”`)));
  const guess = (arrProfiles || []).find((p) => trashProfiles[0] && p.name.toLowerCase().includes(trashProfiles[0].name.toLowerCase().split(' ')[0]));
  if (guess) targetSel.value = String(guess.id);
  const descEl = h('p', { class: 'dim', style: { fontSize: '12px', margin: '6px 0' } });
  const previewEl = h('div', {});
  const footEl = h('div', {});
  let current = null;

  const pill = (t, c) => h('span', { class: `pill ${c}` }, t);
  async function preview() {
    const tp = trashProfiles.find((p) => p.slug === trashSel.value);
    descEl.textContent = tp ? tp.description : '';
    mount(previewEl, spinner());
    mount(footEl);
    try { current = await previewTrashSync(arr, { app, slug: trashSel.value, profileId: targetSel.value || null }); }
    catch (e) { mount(previewEl, h('p', { class: 'dim' }, e.message)); return; }
    const { plan, arrProfile } = current;
    const selected = new Set(plan.formats.filter((f) => f.action !== 'same' || (arrProfile && f.currentScore !== f.score)).map((f) => f.trashId));
    const rows = plan.formats.map((f) => {
      const cb = h('input', { type: 'checkbox', checked: selected.has(f.trashId) ? 'checked' : null, 'aria-label': `Apply ${f.name}` });
      cb.addEventListener('change', () => { if (cb.checked) selected.add(f.trashId); else selected.delete(f.trashId); paintFoot(); });
      const scoreTxt = arrProfile ? (f.currentScore === f.score ? `score ${f.score}` : `score ${f.currentScore ?? '—'} → ${f.score}`) : `TRaSH score ${f.score}`;
      return h('label', { class: 'row', style: { gap: '10px', cursor: 'pointer', padding: '6px 10px' } }, cb,
        h('div', { class: 'row-main' }, h('div', { class: 'row-title', style: { fontSize: '13px' } }, f.name),
          h('div', { class: 'meta-line' },
            f.action === 'create' ? pill('new', 'info') : f.action === 'update' ? pill('rules differ', 'warn') : pill('up to date', 'ok'),
            h('span', { class: 'dim' }, scoreTxt))));
    });
    mount(previewEl,
      h('div', { class: 'meta-line', style: { margin: '6px 0', flexWrap: 'wrap' } },
        pill(`${plan.counts.create} to add`, 'info'), pill(`${plan.counts.update} to update`, 'warn'), pill(`${plan.counts.same} up to date`, 'ok'),
        arrProfile ? h('span', { class: 'dim' }, `${plan.scoreChanges.length} score changes on “${arrProfile.name}”`) : null,
        plan.scoreSet !== 'default' ? h('span', { class: 'dim' }, `score set: ${plan.scoreSet}`) : null),
      plan.thresholds.length ? h('p', { class: 'dim', style: { fontSize: '12px', margin: '0 0 6px' } }, `Also sets ${plan.thresholds.map((t) => `${t.field.replace(/([A-Z])/g, ' $1').toLowerCase()} ${t.from} → ${t.to}`).join(', ')}.`) : null,
      plan.missing.length ? h('p', { class: 'dim', style: { fontSize: '12px' } }, `${plan.missing.length} formats in this profile aren’t in the guide data yet and are skipped.`) : null,
      h('div', { class: 'list', style: { maxHeight: '45vh', overflowY: 'auto' } }, ...rows));
    function paintFoot() {
      const n = plan.formats.filter((f) => selected.has(f.trashId)).length;
      const btn = h('button', { class: 'btn primary', disabled: n ? null : 'disabled', onclick: () => apply(btn, selected) }, n ? `Apply ${n}` : 'Nothing selected');
      mount(footEl, h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '12px', alignItems: 'center', flexWrap: 'wrap' } },
        h('span', { class: 'dim', style: { fontSize: '12px', flex: '1' } }, 'Formats are matched by name. Changing rules or scores changes what gets grabbed and upgraded from now on.'),
        h('button', { class: 'btn', onclick: closeModal }, 'Close'), btn));
    }
    paintFoot();
  }

  async function apply(btn, selected) {
    btn.disabled = true;
    mount(footEl, h('div', { class: 'dim' }, 'Applying…'));
    const res = await applyTrashSync(arr, { plan: current.plan, arrProfile: current.arrProfile, selected });
    toast(`TRaSH sync: ${res.created.length} added, ${res.updated.length} updated${res.scored ? ', scores set' : ''}${res.failed.length ? `, ${res.failed.length} failed` : ''}`, res.failed.length ? 'warn' : 'success', 6000);
    if (res.failed.length) mount(footEl, h('div', { class: 'list' }, ...res.failed.map((f) => h('div', { class: 'row' }, h('div', { class: 'row-main' }, h('b', {}, f.name), h('div', { class: 'dim', style: { fontSize: '12px' } }, f.error))))));
    onDone();
    await preview();
  }

  trashSel.addEventListener('change', preview);
  targetSel.addEventListener('change', preview);
  mount(body,
    h('p', { class: 'dim', style: { margin: '0 0 10px', fontSize: '13px', lineHeight: '1.55' } }, 'Pick a TRaSH Guides profile to add or update its custom formats here, and optionally set its scores on one of your quality profiles. Nothing changes until you press Apply.'),
    h('div', { style: { display: 'grid', gap: '8px' } }, trashSel, targetSel), descEl, previewEl, footEl);
  preview();
}
