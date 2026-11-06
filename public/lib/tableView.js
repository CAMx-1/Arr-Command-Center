import { h } from './ui.js';
import { windowedRows } from './windowed.js';

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

export function compactTable(items, { columns, sortKey, direction = 'asc', onSort, selected = new Set(), onToggle, onOpen, selectionLabel = 'Compare', windowed = false }) {
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
  const makeRow = (entry) => {
    const isSelected = selected.has(entry.id);
    const tr = h('tr', {
      class: `arr-table-row${isSelected ? ' selected' : ''}`,
      dataset: { id: String(entry.id) },
      'aria-selected': onToggle ? String(isSelected) : null,
      onclick: () => onOpen?.(entry),
    },
    onToggle ? h('td', { class: 'table-select-col' }, h('input', {
      type: 'checkbox', checked: isSelected, 'aria-label': `${selectionLabel} ${entry.title || 'item'}`,
      onclick: (event) => event.stopPropagation(), onchange: () => { onToggle(entry); const on = selected.has(entry.id); tr.classList.toggle('selected', on); tr.setAttribute('aria-selected', String(on)); },
    })) : null,
    ...columns.map((column) => h('td', { dataset: { label: column.label } }, column.render ? column.render(entry) : String(column.value(entry) ?? '—'))),
    );
    return tr;
  };
  const tbody = h('tbody', {});
  const span = columns.length + (onToggle ? 1 : 0);
  if (windowed) windowedRows(sorted, makeRow, { container: tbody, chunk: 60, spacer: (px) => h('tr', { class: 'win-spacer', 'aria-hidden': 'true' }, h('td', { colspan: String(span), style: { height: `${px}px`, padding: '0', border: '0' } })) });
  else for (const entry of sorted) tbody.appendChild(makeRow(entry));
  return h('div', { class: 'arr-table-wrap' }, h('table', { class: 'arr-table' }, h('thead', {}, header), tbody));
}
