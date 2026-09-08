import { h, mount, openModal, closeModal, confirmModal, toast } from './ui.js';
import {
  loadDashboards, saveDashboards, activeDashboard, createDashboard,
  removeDashboard, updateDashboard, moveWidget, resetBuiltInDashboard,
} from './dashboardPrefs.js';

const SIZES = [
  { id: 'small', label: 'Small (¼ width)' },
  { id: 'medium', label: 'Medium (½ width)' },
  { id: 'wide', label: 'Wide (⅔ width)' },
  { id: 'full', label: 'Full width' },
];

// Widgets that can render as a flowing poster-hex honeycomb (like the Services
// tiles on the Overview). Only these expose the extra "Hexagons" size.
const HEX_CAPABLE = new Set(['streams', 'seerr']);
const HEX_SIZE = { id: 'hex', label: 'Hexagons' };

function sizesFor(widgetId) {
  return HEX_CAPABLE.has(widgetId) ? [...SIZES, HEX_SIZE] : SIZES;
}

export function dashboardSettingsCard(ctx) {
  const card = h('div', { class: 'card dashboard-settings-card' });
  let state = loadDashboards();
  let draftWidgets = [];
  let draftName = '';
  let draftId = '';

  const resetDraft = () => {
    const dashboard = activeDashboard(state);
    draftId = dashboard.id;
    draftName = dashboard.name;
    draftWidgets = dashboard.widgets.map((widget) => ({ ...widget }));
  };

  const selectDashboard = (id) => {
    state = saveDashboards({ ...state, activeId: id });
    resetDraft();
    render();
  };

  const newDashboard = () => {
    const input = h('input', { class: 'input', maxlength: '60', placeholder: 'Dashboard name' });
    const create = () => {
      try {
        state = saveDashboards(createDashboard(state, input.value));
        closeModal(); resetDraft(); render(); toast('Dashboard created', 'success');
      } catch (error) { toast(error.message, 'error'); }
    };
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') create(); });
    openModal({ title: 'New dashboard', body: input, footer: h('button', { class: 'btn primary', onclick: create }, 'Create') });
  };

  const duplicateDashboard = () => {
    const input = h('input', { class: 'input', maxlength: '60', value: `${draftName} Copy`, placeholder: 'Dashboard name' });
    const duplicate = () => {
      try {
        state = saveDashboards(createDashboard(state, input.value, draftWidgets));
        closeModal(); resetDraft(); render(); toast('Dashboard duplicated', 'success');
      } catch (error) { toast(error.message, 'error'); }
    };
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') duplicate(); });
    openModal({ title: 'Duplicate dashboard', body: input, footer: h('button', { class: 'btn primary', onclick: duplicate }, 'Duplicate') });
  };

  const saveLayout = () => {
    const name = draftId === 'default' ? 'Overview' : draftName.trim();
    if (!name) { toast('Dashboard name is required', 'error'); return; }
    state = saveDashboards(updateDashboard(state, draftId, { name, widgets: draftWidgets }));
    resetDraft(); render(); toast('Dashboard layout saved', 'success');
  };

  const deleteCurrent = () => confirmModal({
    title: 'Delete dashboard',
    message: `Delete “${draftName}”? The built-in Overview will remain available.`,
    confirmLabel: 'Delete', danger: true,
    onConfirm: () => { state = saveDashboards(removeDashboard(state, draftId)); resetDraft(); render(); toast('Dashboard deleted'); },
  });

  const resetOverview = () => confirmModal({
    title: 'Reset Overview layout',
    message: 'Restore the default full-width Services, Activity, Seerr Requests & Issues, Upcoming, and Quick Links layout? Named dashboards will not be changed.',
    confirmLabel: 'Reset Overview',
    onConfirm: () => { state = saveDashboards(resetBuiltInDashboard(state)); resetDraft(); render(); toast('Overview restored', 'success'); },
  });

  const move = (id, delta) => { draftWidgets = moveWidget(draftWidgets, id, delta); render(); };

  const render = () => {
    const dashboard = state.dashboards.find((entry) => entry.id === draftId) || activeDashboard(state);
    if (!dashboard || dashboard.id !== draftId) resetDraft();
    const selector = h('select', { class: 'input dashboard-select', 'aria-label': 'Dashboard shown on Overview' },
      ...state.dashboards.map((entry) => h('option', { value: entry.id, selected: entry.id === state.activeId }, entry.name)),
    );
    selector.value = state.activeId;
    selector.addEventListener('change', () => selectDashboard(selector.value));

    const nameInput = h('input', {
      class: 'input dashboard-name-input', value: draftName, maxlength: '60',
      disabled: draftId === 'default', 'aria-label': 'Dashboard name',
      oninput: (event) => { draftName = event.target.value; },
    });

    const rows = draftWidgets.map((widget, index) => h('div', {
      class: 'dashboard-edit-row', draggable: 'true', dataset: { widget: widget.id },
      ondragstart: (event) => { event.dataTransfer.setData('text/plain', widget.id); event.dataTransfer.effectAllowed = 'move'; event.currentTarget.classList.add('dragging'); },
      ondragend: (event) => event.currentTarget.classList.remove('dragging'),
      ondragover: (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; },
      ondrop: (event) => {
        event.preventDefault();
        const source = event.dataTransfer.getData('text/plain');
        const from = draftWidgets.findIndex((entry) => entry.id === source);
        const to = draftWidgets.findIndex((entry) => entry.id === widget.id);
        if (from >= 0 && to >= 0 && from !== to) move(source, to - from);
      },
    },
      h('span', { class: 'drag-handle', title: 'Drag to reorder' }, '⠿'),
      h('label', { class: 'dashboard-visible' }, h('input', {
        type: 'checkbox', checked: widget.visible,
        onchange: (event) => { widget.visible = event.target.checked; },
      }), h('span', {}, widget.label)),
      h('select', {
        class: 'input dashboard-size-select', 'aria-label': `${widget.label} size`,
        onchange: (event) => { widget.size = event.target.value; },
      }, ...sizesFor(widget.id).map((size) => h('option', { value: size.id, selected: widget.size === size.id }, size.label))),
      h('button', { class: 'btn sm', disabled: index === 0, title: `Move ${widget.label} up`, onclick: () => move(widget.id, -1) }, '↑'),
      h('button', { class: 'btn sm', disabled: index === draftWidgets.length - 1, title: `Move ${widget.label} down`, onclick: () => move(widget.id, 1) }, '↓'),
    ));

    mount(card,
      h('div', { class: 'dashboard-settings-head' },
        h('div', {}, h('h3', { style: { margin: 0 } }, 'Overview dashboards'),
          h('p', { class: 'dim', style: { margin: '5px 0 0' } }, 'Choose the dashboard shown on Overview, then arrange, resize, or hide its widgets here.')),
        h('button', { class: 'btn sm', onclick: () => ctx.go('home') }, 'Open Overview'),
      ),
      h('div', { class: 'dashboard-settings-toolbar' },
        selector,
        h('button', { class: 'btn sm primary', onclick: newDashboard }, '＋ New'),
        h('button', { class: 'btn sm', onclick: duplicateDashboard }, 'Duplicate'),
        draftId !== 'default' ? h('button', { class: 'btn sm danger', onclick: deleteCurrent }, 'Delete') : null,
        h('button', { class: 'btn sm', onclick: resetOverview }, 'Reset Overview'),
      ),
      settingLine('Dashboard name', nameInput),
      h('div', { class: 'dashboard-settings-note dim' }, 'Drag widgets to reorder them. Arrow buttons provide the same control on touch devices. Hidden widgets remain available here.'),
      h('div', { class: 'dashboard-editor' }, ...rows),
      h('div', { class: 'dashboard-settings-save' }, h('button', { class: 'btn primary', onclick: saveLayout }, 'Save dashboard layout')),
    );
  };

  resetDraft(); render();
  return card;
}

function settingLine(label, control) {
  return h('div', { class: 'setting-row' }, h('span', { class: 'dim' }, label), h('span', { class: 'right dashboard-setting-control' }, control));
}
