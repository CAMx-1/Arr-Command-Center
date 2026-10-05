import { h, openModal, closeModal, toast } from './ui.js';

const PREFIX = 'saved-views:';
const storageFor = (storage) => storage || globalThis.localStorage;

export function loadSavedViews(scope, storage) {
  try {
    const value = JSON.parse(storageFor(storage).getItem(`${PREFIX}${scope}`) || '[]');
    return Array.isArray(value) ? value.filter((v) => v && v.id && v.name && v.params) : [];
  } catch { return []; }
}

export function saveNamedView(scope, name, params, storage) {
  const target = storageFor(storage);
  const views = loadSavedViews(scope, target);
  const normalized = String(name || '').trim().slice(0, 60);
  if (!normalized) throw new Error('View name is required');
  const existing = views.find((view) => view.name.toLowerCase() === normalized.toLowerCase());
  const next = existing
    ? views.map((view) => view.id === existing.id ? { ...view, name: normalized, params: { ...params } } : view)
    : [...views, { id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, name: normalized, params: { ...params } }];
  target.setItem(`${PREFIX}${scope}`, JSON.stringify(next));
  return next;
}

export function deleteNamedView(scope, id, storage) {
  const target = storageFor(storage);
  const next = loadSavedViews(scope, target).filter((view) => view.id !== id);
  target.setItem(`${PREFIX}${scope}`, JSON.stringify(next));
  return next;
}

// The saved view whose params match the current route params (if any), so the
// picker keeps showing the active view after applying it re-renders the page.
function sameParams(a = {}, b = {}) {
  const norm = (o) => JSON.stringify(Object.keys(o).filter((k) => o[k] !== '' && o[k] != null).sort().map((k) => [k, String(o[k])]));
  return norm(a) === norm(b);
}

export function savedViewsControl(ctx) {
  const scope = ctx.service.key;
  const wrap = h('div', { class: 'saved-views' });
  const render = () => {
    const views = loadSavedViews(scope);
    const current = views.find((view) => sameParams(view.params, ctx.params || {}));
    const select = h('select', { class: 'input saved-view-select', title: 'Saved views', 'aria-label': 'Saved views' },
      h('option', { value: '' }, 'Saved views…'),
      ...views.map((view) => h('option', { value: view.id, selected: current && current.id === view.id ? 'selected' : null }, view.name)),
    );
    const remove = h('button', { class: 'btn sm', type: 'button', title: 'Delete selected saved view', disabled: select.value ? null : 'disabled', onclick: () => {
      const view = views.find((entry) => entry.id === select.value);
      if (!view) return;
      deleteNamedView(scope, view.id); render(); toast(`Deleted saved view “${view.name}”`, 'success');
    } }, 'Delete');
    select.addEventListener('change', () => {
      remove.disabled = !select.value;
      const view = views.find((entry) => entry.id === select.value);
      if (view) ctx.go(scope, view.params);
    });
    const save = h('button', { class: 'btn sm', type: 'button', onclick: () => {
      const name = h('input', { class: 'input', placeholder: 'e.g. Missing by year', maxlength: '60', 'aria-label': 'View name', enterkeyhint: 'done' });
      const submit = () => {
        try { saveNamedView(scope, name.value, ctx.params); closeModal(); toast('Saved view created', 'success'); render(); }
        catch (error) { toast(error.message, 'error'); }
      };
      name.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); submit(); } });
      openModal({ title: 'Save current view', body: name, footer: h('button', { class: 'btn primary', type: 'button', onclick: submit }, 'Save view') });
      requestAnimationFrame(() => name.focus());
    } }, '☆ Save');
    wrap.replaceChildren(select, save, remove);
  };
  render();
  return wrap;
}
