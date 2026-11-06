// "Compare with another instance" dialog (System tab).
import { h, mount, spinner, empty, openModal, closeModal } from './ui.js';
import { compareInstances, loadSettings } from './compareInstances.js';

const show = (v) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v));

export function sameTypeInstances(ctx) {
  return (ctx.state.services || []).filter((s) => s.type === ctx.service.type && s.key !== ctx.service.key && s.configured);
}

export async function openCompare(arr, ctx) {
  const others = sameTypeInstances(ctx);
  const body = h('div', {});
  openModal({ title: `Compare ${ctx.service.label} settings`, body, wide: true, footer: h('button', { class: 'btn', onclick: closeModal }, 'Close') });
  if (!others.length) { mount(body, empty('', 'No other instance', `Add a second ${ctx.service.type} (for example a 4K or anime instance) to compare settings.`)); return; }
  const sel = h('select', { class: 'input', 'aria-label': 'Compare with' }, ...others.map((s) => h('option', { value: s.key }, s.label)));
  const out = h('div', {});
  const run = async () => {
    const other = others.find((s) => s.key === sel.value);
    mount(out, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px' } }, spinner(), h('span', { class: 'dim' }, 'Reading both instances…')));
    let r;
    try { const [a, b] = await Promise.all([loadSettings(arr), loadSettings(ctx.api.arr(other.key))]); r = compareInstances(a, b); }
    catch (e) { mount(out, h('p', { class: 'dim' }, e.message)); return; }
    const A = ctx.service.label; const B = other.label;
    const kindPill = (k) => (k === 'only-a' ? h('span', { class: 'pill info' }, `only in ${A}`) : k === 'only-b' ? h('span', { class: 'pill info' }, `only in ${B}`) : h('span', { class: 'pill warn' }, 'differs'));
    mount(out,
      h('p', { class: 'dim', style: { margin: '10px 0' } }, r.total ? `${r.total} ${r.total === 1 ? 'difference' : 'differences'} between ${A} and ${B}. Matched by name.` : `${A} and ${B} have the same settings in every section checked.`),
      ...r.sections.filter((s) => s.items.length).map((s) => h('div', {},
        h('div', { class: 'section-title', style: { margin: '12px 0 6px' } }, `${s.title} (${s.items.length})`),
        h('div', { class: 'list' }, ...s.items.map((it) => h('div', { class: 'row', style: { alignItems: 'flex-start' } },
          h('div', { class: 'row-main' },
            h('div', { class: 'row-title', style: { fontSize: '13px' } }, s.id === 'naming' || s.id === 'media' ? it.name.replace(/([A-Z])/g, ' $1').toLowerCase() : it.name, ' ', kindPill(it.kind)),
            ...(it.changes || []).map((c) => h('div', { class: 'meta-line', style: { fontSize: '12px', marginTop: '2px', wordBreak: 'break-all' } },
              s.id === 'profiles' ? h('span', { class: 'dim' }, c.field.replace(/([A-Z])/g, ' $1').toLowerCase()) : null,
              h('span', {}, `${A}: `, h('span', { class: 'mono' }, show(c.a))), h('span', {}, `${B}: `, h('span', { class: 'mono' }, show(c.b)))))))))),
      ));
  };
  sel.addEventListener('change', run);
  mount(body, h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('span', {}, `${ctx.service.label} vs`), sel), out);
  run();
}
