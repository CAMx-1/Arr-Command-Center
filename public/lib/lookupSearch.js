// Full-screen lookup dialog shared by "Add Series" (Sonarr) and "Add Movie"
// (Radarr). Uses the same layout as global Search (`search-modal-overlay`):
// on phones the dialog fills the screen with fixed controls and a scrolling
// results pane, instead of a bottom sheet that the native iOS keyboard
// shrinks/lifts (which only shows on a real device — the simulator's hardware
// keyboard never fires keyboardWillShow).
import { h, mount, clear, spinner, empty, openModal } from './ui.js';
import { dismissNativeKeyboard } from './nativeApp.js';

export function openLookupModal({ title, placeholder, lookup, renderRow, limit = 10, delay = 400 }) {
  const input = h('input', {
    class: 'input', type: 'search', name: 'term', enterkeyhint: 'search',
    autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', autocomplete: 'off',
    placeholder, 'aria-label': placeholder,
  });
  const results = h('div', { class: 'list search-results', 'aria-live': 'polite' });
  let timer = 0;
  let run = 0;
  let dismissal = null;
  const dismissKeyboard = () => {
    if (!dismissal) dismissal = dismissNativeKeyboard(input).finally(() => { dismissal = null; });
    return dismissal;
  };

  const search = async () => {
    const id = ++run;
    const term = input.value.trim();
    if (!term) { clear(results); return; }
    mount(results, spinner());
    try {
      const found = await lookup(term);
      if (id !== run) return; // a newer search superseded this one
      if (!found || !found.length) { mount(results, empty('', 'No matches', 'Try a different title')); return; }
      mount(results, ...found.slice(0, limit).map(renderRow));
    } catch (e) {
      if (id !== run) return;
      mount(results, empty('', 'Search failed', e.message));
    }
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { timer = 0; search(); }, delay); };

  const form = h('form', {
    class: 'search-form', role: 'search',
    onsubmit: async (e) => {
      e.preventDefault();
      clearTimeout(timer); timer = 0;
      await dismissKeyboard();
      search();
    },
  }, input, h('button', { class: 'btn primary search-submit', type: 'submit', 'aria-label': 'Submit search', onclick: () => { void dismissKeyboard(); } }, 'Search'));

  input.addEventListener('input', schedule);
  // Scrolling the matches dismisses the keyboard so the whole list is reachable.
  results.addEventListener('touchmove', dismissKeyboard, { passive: true });
  results.addEventListener('scroll', dismissKeyboard, { passive: true });

  const overlay = openModal({
    title,
    body: h('div', { class: 'search-shell' }, form, results),
    wide: true,
    overlayClass: 'search-modal-overlay',
  });
  setTimeout(() => input.focus(), 50);
  return { overlay, input, results };
}
