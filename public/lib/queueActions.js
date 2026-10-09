// Shared queue-row actions for Sonarr/Radarr, used by the service Queue tabs
// and by Overview's Action Inbox so the same choices exist everywhere:
//   • Fix import         (when the download finished but couldn't import)
//   • Remove…            dialog: remove from client / blocklist / search again
//   • Blocklist & search one tap: blocklist this release and grab another
//
// *arr API: DELETE queue/{id}?removeFromClient=&blocklist=&skipRedownload=
// With blocklist=true the *arr searches for a replacement itself unless
// skipRedownload=true, so no separate search command is needed.
import { h, openModal, closeModal, toast } from './ui.js';
import { actionGroup } from './actions.js';
import { queueImportAction } from './arrActions.js';
import { isImportStuck } from './manualImport.js';

export function removeQueueQuery({ removeFromClient = true, blocklist = false, search = false } = {}) {
  return new URLSearchParams({
    removeFromClient: String(!!removeFromClient),
    blocklist: String(!!blocklist),
    // skipRedownload only matters when blocklisting; "search" means "find another".
    skipRedownload: String(!(blocklist && search)),
  }).toString();
}

export async function removeQueueItem(client, record, opts) {
  await client.del(`queue/${record.id}?${removeQueueQuery(opts)}`);
}

// ---- Undo toast ----
// Shows `message` with an Undo button for `ms`. `run` is only called if the
// user doesn't undo (or if the page is being closed). Returns { undo, flush }.
export function toastWithUndo(message, { ms = 5000, run, onUndo } = {}) {
  const container = document.getElementById('toast-container');
  let settled = false;
  const finish = (doRun) => {
    if (settled) return; settled = true;
    clearTimeout(timer);
    window.removeEventListener('pagehide', flush);
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 250);
    if (doRun) run && run();
    else onUndo && onUndo();
  };
  const undo = () => finish(false);
  const flush = () => finish(true);
  const bar = h('span', { class: 'toast-undo-bar', style: { animationDuration: `${ms}ms` } });
  const el = h('div', { class: 'toast info toast-undo', role: 'status' },
    h('div', { class: 'toast-face' }, h('span', {}, message),
      h('button', { class: 'toast-undo-btn', type: 'button', onclick: undo }, 'Undo')),
    bar);
  container.appendChild(el);
  const timer = setTimeout(flush, ms);
  // Navigating away or closing the app shouldn't silently drop the action.
  window.addEventListener('pagehide', flush, { once: true });
  return { undo, flush };
}

// Remove with a grace period: hide the row immediately, send the DELETE only
// after the undo window, and bring the row back if the user taps Undo.
export function removeWithUndo(client, record, opts, { onDone, rowEl } = {}) {
  const row = rowEl && (rowEl.closest('.swipe-wrap') || rowEl);
  if (row) row.classList.add('pending-remove');
  toastWithUndo(pendingMessage(opts, record), {
    run: async () => {
      try { await removeQueueItem(client, record, opts); toast(successMessage(opts), 'success', 2200); onDone && onDone(); }
      catch (e) { if (row) row.classList.remove('pending-remove'); toast(e.message, 'error'); }
    },
    onUndo: () => { if (row) { row.classList.remove('pending-remove'); row.style.opacity = ''; row.style.transform = ''; const inner = row.querySelector('.row'); if (inner) inner.style.transform = ''; } toast('Kept in queue', 'info', 1600); },
  });
}

function pendingMessage(opts, record) {
  const what = record.title ? `“${record.title.length > 42 ? `${record.title.slice(0, 40)}…` : record.title}”` : 'Download';
  if (opts.blocklist && opts.search) return `${what} will be blocklisted and replaced`;
  if (opts.blocklist) return `${what} will be removed and blocklisted`;
  return `${what} will be removed`;
}

function successMessage({ blocklist, search }) {
  if (blocklist && search) return 'Blocklisted — searching for a replacement';
  if (blocklist) return 'Removed and blocklisted';
  return 'Removed from queue';
}

// Remove dialog mirroring Sonarr/Radarr's own: three clear choices, sensible
// defaults (remove from client, no blocklist), one confirm button.
export function openRemoveQueueDialog(client, record, { onDone, rowEl } = {}) {
  const box = (label, hint, checked) => {
    const input = h('input', { type: 'checkbox', checked: checked ? 'checked' : null });
    const row = h('label', { class: 'queue-remove-opt' }, input,
      h('span', {}, h('strong', {}, label), h('span', { class: 'dim' }, hint)));
    return { input, row };
  };
  const fromClient = box('Remove from download client', 'Deletes the download and its files from the client', true);
  const blocklist = box('Blocklist this release', 'It will never be grabbed again', false);
  const search = box('Search for a replacement', 'Grab a different release right away', true);
  const sync = () => {
    search.input.disabled = !blocklist.input.checked;
    search.row.classList.toggle('disabled', !blocklist.input.checked);
  };
  blocklist.input.addEventListener('change', sync);
  sync();
  const go = () => {
    const opts = { removeFromClient: fromClient.input.checked, blocklist: blocklist.input.checked, search: blocklist.input.checked && search.input.checked };
    closeModal();
    removeWithUndo(client, record, opts, { onDone, rowEl });
  };
  const confirm = h('button', { class: 'btn danger', type: 'button', onclick: go }, 'Remove');
  openModal({
    title: 'Remove from queue',
    body: h('div', { class: 'queue-remove' },
      h('p', { class: 'queue-remove-title' }, record.title || 'Queued download'),
      fromClient.row, blocklist.row, search.row),
    footer: h('div', { class: 'modal-actions' }, h('button', { class: 'btn', type: 'button', onclick: closeModal }, 'Cancel'), confirm),
  });
}

// The action list for one queue record. `kind` is 'series' | 'movie'.
// `getRow` (optional) returns the row element so it can be hidden during the
// undo window.
export function queueActionList(client, kind, record, { onDone, getRow } = {}) {
  const stuck = isImportStuck(record);
  const rowOf = (e) => (getRow && getRow()) || e?.currentTarget?.closest?.('.row') || null;
  return [
    queueImportAction(client, kind, record, { reload: onDone }),
    { label: 'Remove…', title: 'Remove, optionally blocklist and search again', variant: 'danger', primary: !stuck, onClick: (e) => { e?.stopPropagation?.(); openRemoveQueueDialog(client, record, { onDone, rowEl: rowOf(e) }); } },
    { label: 'Blocklist & search', title: 'Blocklist this release and search for a replacement', onClick: (e) => {
      e?.stopPropagation?.();
      removeWithUndo(client, record, { removeFromClient: true, blocklist: true, search: true }, { onDone, rowEl: rowOf(e) });
    } },
  ].filter(Boolean);
}

export function queueActions(client, kind, record, opts = {}) {
  return actionGroup(queueActionList(client, kind, record, opts), { sheetTitle: record.title });
}
