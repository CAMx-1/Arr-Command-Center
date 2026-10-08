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

function successMessage({ blocklist, search }) {
  if (blocklist && search) return 'Blocklisted — searching for a replacement';
  if (blocklist) return 'Removed and blocklisted';
  return 'Removed from queue';
}

// Remove dialog mirroring Sonarr/Radarr's own: three clear choices, sensible
// defaults (remove from client, no blocklist), one confirm button.
export function openRemoveQueueDialog(client, record, { onDone } = {}) {
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
  const go = async (btn) => {
    const opts = { removeFromClient: fromClient.input.checked, blocklist: blocklist.input.checked, search: blocklist.input.checked && search.input.checked };
    btn.disabled = true;
    try {
      await removeQueueItem(client, record, opts);
      closeModal();
      toast(successMessage(opts), 'success');
      onDone && onDone();
    } catch (e) { btn.disabled = false; toast(e.message, 'error'); }
  };
  const confirm = h('button', { class: 'btn danger', type: 'button', onclick: (e) => go(e.currentTarget) }, 'Remove');
  openModal({
    title: 'Remove from queue',
    body: h('div', { class: 'queue-remove' },
      h('p', { class: 'queue-remove-title' }, record.title || 'Queued download'),
      fromClient.row, blocklist.row, search.row),
    footer: h('div', { class: 'modal-actions' }, h('button', { class: 'btn', type: 'button', onclick: closeModal }, 'Cancel'), confirm),
  });
}

// The action list for one queue record. `kind` is 'series' | 'movie'.
export function queueActionList(client, kind, record, { onDone } = {}) {
  const stuck = isImportStuck(record);
  return [
    queueImportAction(client, kind, record, { reload: onDone }),
    { label: 'Remove…', title: 'Remove, optionally blocklist and search again', variant: 'danger', primary: !stuck, onClick: (e) => { e?.stopPropagation?.(); openRemoveQueueDialog(client, record, { onDone }); } },
    { label: 'Blocklist & search', title: 'Blocklist this release and search for a replacement', onClick: async (e) => {
      e?.stopPropagation?.();
      try { await removeQueueItem(client, record, { removeFromClient: true, blocklist: true, search: true }); toast(successMessage({ blocklist: true, search: true }), 'success'); onDone && onDone(); }
      catch (err) { toast(err.message, 'error'); }
    } },
  ].filter(Boolean);
}

export function queueActions(client, kind, record, opts = {}) {
  return actionGroup(queueActionList(client, kind, record, opts), { sheetTitle: record.title });
}
