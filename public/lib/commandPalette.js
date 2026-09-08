import { h, openModal, closeModal } from './ui.js';
import { loadSavedViews } from './savedViews.js';
import { loadDashboards, saveDashboards } from './dashboardPrefs.js';
import { getTheme, applyTheme } from './theme.js';

function commandSet({ services, go, openSearch }) {
  const commands = [
    { label: 'Go to Overview', hint: 'Navigation', run: () => go('home') },
    { label: 'Open Action Inbox', hint: 'Dashboard', run: () => go('home', { focus: 'inbox' }) },
    { label: 'Search all libraries', hint: '/', run: () => setTimeout(openSearch, 0) },
    { label: `Switch to ${getTheme() === 'dark' ? 'light' : 'dark'} theme`, hint: 'Appearance', run: () => applyTheme(getTheme() === 'dark' ? 'light' : 'dark') },
  ];
  for (const service of services || []) {
    commands.push({ label: `Open ${service.label}`, hint: service.type, run: () => go(service.key) });
    if (service.type === 'sonarr' || service.type === 'radarr') {
      for (const tab of ['queue', 'wanted', 'history', 'system']) commands.push({ label: `${service.label}: ${tab}`, hint: 'Service tab', run: () => go(service.key, { tab }) });
      for (const view of loadSavedViews(service.key)) commands.push({ label: `${service.label}: ${view.name}`, hint: 'Saved view', run: () => go(service.key, view.params) });
    }
  }
  const dashboards = loadDashboards();
  for (const dashboard of dashboards.dashboards) commands.push({
    label: `Dashboard: ${dashboard.name}`, hint: 'Saved dashboard',
    run: () => { saveDashboards({ ...dashboards, activeId: dashboard.id }); go('home'); },
  });
  return commands;
}

export function openCommandPalette(options) {
  const commands = commandSet(options);
  const input = h('input', { class: 'input command-input', type: 'search', placeholder: 'Type a command or destination…', autocomplete: 'off' });
  const results = h('div', { class: 'command-results', role: 'listbox' });
  let filtered = commands;
  let active = 0;
  const run = (command) => { closeModal(); setTimeout(command.run, 40); };
  const render = () => {
    const term = input.value.trim().toLowerCase();
    filtered = commands.filter((command) => `${command.label} ${command.hint}`.toLowerCase().includes(term)).slice(0, 30);
    active = Math.min(active, Math.max(0, filtered.length - 1));
    results.replaceChildren(...filtered.map((command, index) => h('button', {
      class: `command-item${index === active ? ' active' : ''}`, role: 'option', 'aria-selected': index === active,
      onmouseenter: () => { active = index; render(); }, onclick: () => run(command),
    }, h('span', {}, command.label), h('span', { class: 'dim' }, command.hint))));
    if (!filtered.length) results.appendChild(h('div', { class: 'empty', style: { padding: '20px' } }, 'No matching commands'));
  };
  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); active = Math.min(filtered.length - 1, active + 1); render(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); active = Math.max(0, active - 1); render(); }
    else if (event.key === 'Enter' && filtered[active]) { event.preventDefault(); run(filtered[active]); }
  });
  render();
  openModal({ title: 'Command palette', body: h('div', { class: 'command-palette' }, input, results), wide: true });
  requestAnimationFrame(() => input.focus());
}
