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

export function savedViewsControl(ctx) {
  const scope = ctx.service.key;
  const wrap = h('div', { class: 'saved-views' });
  const render = () => {
    const views = loadSavedViews(scope);
    const select = h('select', { class: 'input saved-view-select', title: 'Saved views' },
      h('option', { value: '' }, 'Saved views…'),
      ...views.map((view) => h('option', { value: view.id }, view.name)),
    );
    select.addEventListener('change', () => {
      const view = views.find((entry) => entry.id === select.value);
      if (view) ctx.go(scope, view.params);
    });
    const save = h('button', { class: 'btn sm', onclick: () => {
      const name = h('input', { class: 'input', placeholder: 'e.g. Missing by year', maxlength: '60' });
      const submit = () => {
        try { saveNamedView(scope, name.value, ctx.params); closeModal(); toast('Saved view created', 'success'); render(); }
        catch (error) { toast(error.message, 'error'); }
      };
      name.addEventListener('keydown', (event) => { if (event.key === 'Enter') submit(); });
      openModal({ title: 'Save current view', body: name, footer: h('button', { class: 'btn primary', onclick: submit }, 'Save view') });
    } }, '☆ Save');
    const remove = h('button', { class: 'btn sm', title: 'Delete selected saved view', onclick: () => {
      if (!select.value) return;
      deleteNamedView(scope, select.value); render(); toast('Saved view deleted');
    } }, 'Delete');
    wrap.replaceChildren(select, save, remove);
  };
  render();
  return wrap;
}
