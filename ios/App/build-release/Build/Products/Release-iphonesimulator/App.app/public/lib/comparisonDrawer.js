import { h, registerOverlay, closeOverlay, overlayOpen, fmtBytes } from './ui.js';

export function closeComparisonDrawer() {
  if (overlayOpen('comparison')) closeOverlay('comparison');
  else document.getElementById('comparison-root')?.remove();
}

export function openComparisonDrawer(title, items, fields) {
  document.getElementById('comparison-root')?.remove();
  const root = h('div', { id: 'comparison-root', class: 'compare-backdrop', onclick: (event) => { if (event.target === root) closeComparisonDrawer(); } });
  const panel = h('aside', { class: 'compare-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'compare-head' }, h('div', {}, h('strong', {}, title), h('div', { class: 'dim' }, `${items.length} selected`)), h('button', { class: 'close-x', 'aria-label': 'Close comparison', onclick: closeComparisonDrawer }, '×')),
    h('div', { class: 'compare-scroll' },
      h('table', { class: 'compare-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Field'), ...items.map((entry) => h('th', {}, entry.title || 'Item')))),
        h('tbody', {}, ...fields.map((field) => h('tr', {}, h('th', { scope: 'row' }, field.label), ...items.map((entry) => {
          const value = field.value(entry);
          return h('td', {}, field.bytes ? fmtBytes(value) : String(value ?? '—'));
        })))),
      ),
    ),
  );
  root.appendChild(panel);
  document.body.appendChild(root);
  requestAnimationFrame(() => root.classList.add('show'));
  registerOverlay('comparison', { container: panel, close: () => root.remove() });
}

export function comparisonBar(selected, { title, fields, onClear }) {
  const items = [...selected.values()];
  return h('div', { class: `compare-bar${items.length ? ' show' : ''}` },
    h('span', {}, `${items.length} selected for comparison`),
    h('button', { class: 'btn sm primary', disabled: items.length < 2, onclick: () => openComparisonDrawer(title, items, fields) }, 'Compare'),
    h('button', { class: 'btn sm', disabled: !items.length, onclick: onClear }, 'Clear'),
  );
}
