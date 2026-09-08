import { h } from './ui.js';

export function compareValues(a, b) {
  const av = a ?? '';
  const bv = b ?? '';
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
}

export function sortTableItems(items, columns, sortKey, direction = 'asc') {
  const column = columns.find((c) => c.key === sortKey) || columns[0];
  const sign = direction === 'desc' ? -1 : 1;
  return items.map((value, index) => ({ value, index })).sort((a, b) => {
    const result = compareValues(column.value(a.value), column.value(b.value));
    return result ? result * sign : a.index - b.index;
  }).map((entry) => entry.value);
}

export function compactTable(items, { columns, sortKey, direction = 'asc', onSort, selected = new Set(), onToggle, onOpen, selectionLabel = 'Compare' }) {
  const sorted = sortTableItems(items, columns, sortKey, direction);
  const header = h('tr', {},
    onToggle ? h('th', { class: 'table-select-col', scope: 'col' }, h('span', { class: 'sr-only' }, selectionLabel)) : null,
    ...columns.map((column) => {
      const active = column.key === sortKey;
      return h('th', { scope: 'col', 'aria-sort': active ? (direction === 'desc' ? 'descending' : 'ascending') : 'none' },
        h('button', { class: 'table-sort', onclick: () => onSort(column.key, active && direction === 'asc' ? 'desc' : 'asc') },
          column.label, active ? (direction === 'desc' ? ' ↓' : ' ↑') : ''),
      );
    }),
  );
  const rows = sorted.map((entry) => {
    const isSelected = selected.has(entry.id);
    return h('tr', {
      class: `arr-table-row${isSelected ? ' selected' : ''}`,
      dataset: { id: String(entry.id) },
      'aria-selected': onToggle ? String(isSelected) : null,
      onclick: () => onOpen?.(entry),
    },
    onToggle ? h('td', { class: 'table-select-col' }, h('input', {
      type: 'checkbox', checked: isSelected, 'aria-label': `${selectionLabel} ${entry.title || 'item'}`,
      onclick: (event) => event.stopPropagation(), onchange: () => onToggle(entry),
    })) : null,
    ...columns.map((column) => h('td', { dataset: { label: column.label } }, column.render ? column.render(entry) : String(column.value(entry) ?? '—'))),
    );
  });
  return h('div', { class: 'arr-table-wrap' }, h('table', { class: 'arr-table' }, h('thead', {}, header), h('tbody', {}, ...rows)));
}
