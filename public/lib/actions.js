// Centralized, reusable action helpers: elongated-hex buttons, responsive
// action groups, and a mobile bottom-sheet ("More") for overflow actions.
//
// An "action" is a plain object describing one thing the user can do:
//   { id?, label, title?, icon?, variant?, primary?, disabled?, onClick(event) }
//     variant : 'default' | 'primary' | 'danger'  (styles the button)
//     primary : marks the single action kept visible on mobile (defaults to the
//               first action when none is flagged)
//     icon    : optional leading glyph (rendered before the label)
//
// Desktop shows every action inline. Mobile (<=720px) shows one primary action
// plus a "More" button that opens a bottom-sheet listing all actions. The
// desktop/mobile switch is CSS-driven (.ag-extra / .ag-more) so it survives
// viewport resizes without re-rendering.

import { h, registerOverlay, closeOverlay } from './ui.js';

const MOBILE_QUERY = '(max-width: 720px)';

// True when the viewport is in the mobile action-group breakpoint.
export function isMobileViewport() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(MOBILE_QUERY).matches
    : false;
}

// Decide which action stays visible on mobile: the flagged primary, else first.
export function primaryActionIndex(actions) {
  const list = (actions || []).filter(Boolean);
  if (!list.length) return -1;
  const flagged = list.findIndex((a) => a && a.primary);
  return flagged >= 0 ? flagged : 0;
}

function variantClass(variant) {
  if (variant === 'primary') return 'primary';
  if (variant === 'danger') return 'danger';
  return '';
}

function withIcon(action) {
  return action.icon ? `${action.icon} ${action.label}` : action.label;
}

// Build a single elongated-hex action button from an action object.
// `size` defaults to 'sm' to match existing row buttons; pass size:'md' for
// full-size buttons (e.g. modal footers).
export function actionButton(action, { size = 'sm' } = {}) {
  const cls = ['btn', size === 'sm' ? 'sm' : '', 'hex-btn', variantClass(action.variant)]
    .filter(Boolean).join(' ');
  const btn = h('button', {
    class: cls,
    type: 'button',
    title: action.title || action.label,
    disabled: action.disabled ? 'disabled' : null,
  }, withIcon(action));
  btn.addEventListener('click', (event) => {
    // Rows/cards are often clickable; keep an action tap from triggering them.
    event.stopPropagation();
    if (action.disabled) return;
    if (typeof action.onClick === 'function') action.onClick(event);
  });
  return btn;
}

// Build a responsive `.row-actions.action-group` from an array of actions.
// Falsy entries are ignored so callers can inline conditionals.
//   opts.size       : forwarded to actionButton ('sm' | 'md')
//   opts.sheetTitle : title shown at the top of the mobile bottom-sheet
export function actionGroup(actions, opts = {}) {
  const list = (actions || []).filter(Boolean);
  const group = h('div', { class: 'row-actions action-group' });
  if (!list.length) return group;

  const primaryIdx = primaryActionIndex(list);
  list.forEach((action, index) => {
    const btn = actionButton(action, opts);
    // Everything except the primary is desktop-only; hidden on mobile via CSS.
    if (index !== primaryIdx) btn.classList.add('ag-extra');
    group.appendChild(btn);
  });

  // A "More" affordance shown only on mobile (CSS) that opens the full list in
  // a bottom-sheet. Skipped when there's just a single action.
  if (list.length > 1) {
    const more = h('button', {
      class: 'btn sm hex-btn ag-more',
      type: 'button',
      title: 'More actions',
      'aria-label': 'More actions',
    }, '\u22ef'); // ⋯
    more.addEventListener('click', (event) => {
      event.stopPropagation();
      actionSheet({ title: opts.sheetTitle || 'Actions', actions: list });
    });
    group.appendChild(more);
  }
  return group;
}

// Bottom-sheet listing a set of actions (used by the mobile "More" button, and
// available directly for any overflow menu). Wired through the shared overlay
// controller so hardware Back, Escape, focus-trap and focus-restore all work.
export function actionSheet({ title, actions }) {
  const list = (actions || []).filter(Boolean);
  if (!list.length) return null;
  const id = 'action-sheet';

  const items = h('div', { class: 'action-sheet-list' });
  const close = () => closeOverlay(id);
  list.forEach((action) => {
    const item = h('button', {
      class: `action-sheet-item ${variantClass(action.variant)}`.trim(),
      type: 'button',
      disabled: action.disabled ? 'disabled' : null,
    },
      action.icon ? h('span', { class: 'action-sheet-ico' }, action.icon) : null,
      h('span', {}, action.label),
    );
    item.addEventListener('click', (event) => {
      if (action.disabled) return;
      close();
      // Run synchronously (mirrors confirmModal) so the handler still sees a
      // live event target; the sheet DOM is already torn down by close().
      try { if (typeof action.onClick === 'function') action.onClick(event); } catch { /* ignore */ }
    });
    items.appendChild(item);
  });

  const sheet = h('div', { class: 'action-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Actions' },
    h('div', { class: 'action-sheet-grip', 'aria-hidden': 'true' }),
    title ? h('div', { class: 'action-sheet-title' }, title) : null,
    items,
    h('button', { class: 'btn action-sheet-cancel', type: 'button', onclick: close }, 'Cancel'),
  );
  const backdrop = h('div', { class: 'action-sheet-backdrop', onclick: (event) => { if (event.target === backdrop) close(); } }, sheet);
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => { backdrop.classList.add('show'); sheet.classList.add('show'); });

  registerOverlay(id, { container: sheet, close: () => { try { backdrop.remove(); } catch { /* ignore */ } } });
  return backdrop;
}
