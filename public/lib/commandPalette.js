import { h, openModal, closeModal } from './ui.js';
import { loadSavedViews } from './savedViews.js';
import { loadDashboards, saveDashboards } from './dashboardPrefs.js';
import { getTheme, applyTheme } from './theme.js';

function commandSet({ services, go, openSearch, openShortcuts }) {
  const commands = [
    { label: 'Go to Overview', hint: 'Navigation', run: () => go('home') },
    { label: 'Open Settings', hint: 'Navigation', run: () => go('settings') },
    { label: 'Open Action Inbox', hint: 'Dashboard', run: () => go('home', { focus: 'inbox' }) },
    { label: 'Search all libraries', hint: '/', run: () => setTimeout(openSearch, 0) },
    openShortcuts ? { label: 'Keyboard shortcuts', hint: '?', run: () => setTimeout(openShortcuts, 0) } : null,
    { label: `Switch to ${getTheme() === 'dark' ? 'light' : 'dark'} theme`, hint: 'Appearance', run: () => applyTheme(getTheme() === 'dark' ? 'light' : 'dark') },
  ].filter(Boolean);
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
  let ran = false;
  // Close first, then run once the overlay's history pop has settled so a
  // navigation isn't reverted by the pending history.back().
  const run = (command) => {
    if (ran) return; ran = true;
    closeModal();
    let done = false;
    const go = () => { if (done) return; done = true; window.removeEventListener('popstate', go); setTimeout(command.run, 0); };
    window.addEventListener('popstate', go);
    setTimeout(go, 250);
  };
  const paint = () => {
    [...results.querySelectorAll('.command-item')].forEach((el, index) => {
      el.classList.toggle('active', index === active);
      el.setAttribute('aria-selected', String(index === active));
      if (index === active) { input.setAttribute('aria-activedescendant', el.id); el.scrollIntoView({ block: 'nearest' }); }
    });
  };
  const render = () => {
    const term = input.value.trim().toLowerCase();
    filtered = commands.filter((command) => `${command.label} ${command.hint}`.toLowerCase().includes(term)).slice(0, 30);
    active = Math.max(0, Math.min(active, filtered.length - 1));
    results.replaceChildren(...filtered.map((command, index) => h('button', {
      id: `cmd-opt-${index}`, type: 'button', tabindex: '-1',
      class: `command-item${index === active ? ' active' : ''}`, role: 'option', 'aria-selected': String(index === active),
      // Hover only moves the highlight; re-rendering here would replace the
      // node under the pointer and swallow the click.
      onmousemove: () => { if (active !== index) { active = index; paint(); } },
      onclick: () => run(command),
    }, h('span', {}, command.label), h('span', { class: 'dim' }, command.hint))));
    if (!filtered.length) { input.removeAttribute('aria-activedescendant'); results.appendChild(h('div', { class: 'empty', style: { padding: '20px' } }, 'No matching commands')); }
    else paint();
  };
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', 'command-results');
  input.setAttribute('aria-label', 'Command');
  results.id = 'command-results';
  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', (event) => {
    if (!filtered.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); active = (active + 1) % filtered.length; paint(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); active = (active - 1 + filtered.length) % filtered.length; paint(); }
    else if (event.key === 'Home' && event.ctrlKey) { event.preventDefault(); active = 0; paint(); }
    else if (event.key === 'End' && event.ctrlKey) { event.preventDefault(); active = filtered.length - 1; paint(); }
    else if (event.key === 'Enter' && !event.isComposing && filtered[active]) { event.preventDefault(); run(filtered[active]); }
  });
  render();
  openModal({ title: 'Command palette', body: h('div', { class: 'command-palette' }, input, results), wide: true });
  requestAnimationFrame(() => input.focus());
}
