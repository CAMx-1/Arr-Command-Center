// Settings → System → "Back up Arr Command Center": make an encrypted backup
// of the server's own settings, and restore one (server/selfBackup.js).
import { h, mount, toast, fmtRelative, fmtBytes } from './ui.js';
import { api } from './api.js';

const MAX_FILE = 45 * 1024 * 1024;

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const say = (el, text, kind = '') => { mount(el, text ? h('span', { style: { color: kind === 'error' ? 'var(--red)' : kind === 'ok' ? 'var(--green)' : '' } }, text) : null); };
const pass = (placeholder, autocomplete) => h('input', { class: 'input', type: 'password', placeholder, autocomplete, autocapitalize: 'off', spellcheck: 'false', style: { flex: '1 1 200px' } });
const when = (at) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function selfBackupSummary() {
  return api.getJson('/api/self-backup').then((d) => (d.last && d.last.lastExport ? `Last backup ${fmtRelative(d.last.lastExport.at)}` : 'No backup yet'));
}

export function selfBackupCard() {
  const card = h('div', { class: 'card', id: 'self-backup-panel' }, h('div', { class: 'dim' }, 'Loading…'));
  let status = null;

  // ---- make a backup ----
  function makeBlock() {
    const p1 = pass(`Passphrase (at least ${status.minPassphrase} characters)`, 'new-password');
    const p2 = pass('The same passphrase again', 'new-password');
    const msg = h('div', { class: 'self-backup-msg' });
    const go = h('button', { class: 'btn sm primary', onclick: async () => {
      if (p1.value.length < status.minPassphrase) return say(msg, `Use at least ${status.minPassphrase} characters. A few random words work well.`, 'error');
      if (p1.value !== p2.value) return say(msg, 'The two passphrases don’t match.', 'error');
      go.disabled = true; say(msg, 'Encrypting…');
      try {
        const d = await api.sendJson('/api/self-backup/export', { passphrase: p1.value });
        download(d.fileName, JSON.stringify(d.backup));
        p1.value = ''; p2.value = '';
        say(msg, `Saved ${d.fileName}. Keep the passphrase somewhere safe: without it the file can’t be opened.`, 'ok');
        lastLine.textContent = 'Last backup just now.';
      } catch (e) { say(msg, e.cancelled ? '' : e.message, 'error'); }
      go.disabled = false;
    } }, 'Make backup');
    p2.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
    const last = status.last && status.last.lastExport;
    const lastLine = h('p', { class: 'dim', style: { fontSize: '12px', margin: '6px 0 0' } }, last ? `Last backup ${fmtRelative(last.at)}${last.by && last.by !== 'admin' ? ` by ${last.by}` : ''}.` : 'No backup made yet.');
    return h('div', {},
      h('div', { class: 'section-title', style: { margin: '16px 0 6px' } }, 'Make a backup'),
      h('div', { class: 'self-backup-row' }, p1, p2, go), msg, lastLine);
  }

  // ---- restore ----
  function restoreBlock() {
    const out = h('div', {});
    const file = h('input', { type: 'file', accept: '.arrccbackup,application/json,.json', style: { display: 'none' } });
    const fileName = h('span', { class: 'dim', style: { alignSelf: 'center', fontSize: '13px' } }, 'No file chosen');
    const p = pass('The backup’s passphrase', 'off');
    const msg = h('div', { class: 'self-backup-msg' });
    let opened = null; // { backup, passphrase }
    file.addEventListener('change', () => { fileName.textContent = file.files[0] ? file.files[0].name : 'No file chosen'; mount(out); say(msg, ''); });
    const open = h('button', { class: 'btn sm', onclick: async () => {
      const f = file.files && file.files[0];
      if (!f) return say(msg, 'Choose a backup file first.', 'error');
      if (f.size > MAX_FILE) return say(msg, 'That file is too big to be a backup of Arr Command Center.', 'error');
      if (!p.value) return say(msg, 'Enter the passphrase it was made with.', 'error');
      open.disabled = true; say(msg, 'Opening…'); mount(out);
      try {
        let backup;
        try { backup = JSON.parse(await f.text()); } catch { throw new Error('That file isn’t a backup of Arr Command Center.'); }
        const plan = await api.sendJson('/api/self-backup/preview', { backup, passphrase: p.value });
        opened = { backup, passphrase: p.value };
        say(msg, '');
        mount(out, preview(plan));
      } catch (e) { say(msg, e.message, 'error'); }
      open.disabled = false;
    } }, 'Open backup');
    p.addEventListener('keydown', (e) => { if (e.key === 'Enter') open.click(); });

    function preview(plan) {
      const boxes = new Map();
      const restoreBtn = h('button', { class: 'btn sm danger' });
      const chosen = () => [...boxes.entries()].filter(([, b]) => b.checked).map(([id]) => id);
      const sync = () => {
        const n = chosen().length;
        restoreBtn.dataset.armed = '';
        restoreBtn.disabled = !n;
        restoreBtn.textContent = n ? `Restore ${n} ${n === 1 ? 'part' : 'parts'}` : 'Nothing ticked';
      };
      const svc = plan.services;
      const svcRows = (title, rows, line) => (rows.length ? h('div', { class: 'self-backup-svc' }, h('span', { class: 'dim' }, `${title}: `), rows.map(line).join(', ')) : null);
      const part = (p) => {
        const box = h('input', { type: 'checkbox', 'aria-label': `Restore ${p.label}`, checked: !p.empty && !p.blocked && !p.same ? 'checked' : null, disabled: p.empty || p.blocked ? 'disabled' : null, onchange: sync });
        if (!p.empty && !p.blocked) boxes.set(p.id, box);
        const state = p.blocked ? h('span', { class: 'pill warn' }, 'can’t restore') : p.empty ? h('span', { class: 'pill muted' }, 'not in the backup') : p.same ? h('span', { class: 'pill muted' }, 'same as here') : null;
        return h('label', { class: 'self-backup-part' }, box,
          h('div', { class: 'self-backup-part-main' },
            h('div', { class: 'self-backup-part-title' }, p.label, ' ', state),
            p.empty ? null : h('div', { class: 'meta-line' }, h('span', {}, `In the backup: ${p.backup}`), h('span', {}, `Here now: ${p.here}`), p.adds ? h('span', {}, 'added to what’s here') : null),
            p.id === 'services' && !p.empty ? h('div', {},
              svcRows('New', svc.add, (r) => `${r.label}${r.host ? ` (${r.host})` : ''}`),
              svcRows('Changed', svc.change, (r) => `${r.label} (${r.changes.join(', ')})`),
              svc.same.length ? h('div', { class: 'self-backup-svc dim' }, `${svc.same.length} the same as here`) : null,
              svcRows('Left out', svc.skip, (r) => `${r.label}: ${r.reason}`)) : null,
            p.blocked ? h('div', { class: 'self-backup-warn' }, p.blocked) : null,
            ...(p.warnings || []).map((w) => h('div', { class: 'self-backup-warn' }, w))));
      };
      restoreBtn.onclick = async () => {
        const parts = chosen();
        if (!parts.length) return;
        if (restoreBtn.dataset.armed !== '1') { restoreBtn.dataset.armed = '1'; restoreBtn.textContent = `Restore ${parts.length} ${parts.length === 1 ? 'part' : 'parts'}? This replaces what’s here`; return; }
        restoreBtn.disabled = true; restoreBtn.textContent = 'Restoring…';
        try {
          const r = await api.sendJson('/api/self-backup/restore', { ...opened, parts });
          mount(out, result(r));
          toast('Backup restored', 'success');
        } catch (e) { if (!e.cancelled) toast(e.message, 'error', 7000); sync(); }
      };
      const items = plan.parts.map(part);
      sync();
      return h('div', { class: 'self-backup-preview' },
        h('p', { style: { margin: '10px 0 8px', fontSize: '13px' } }, `Made ${plan.createdAt ? when(plan.createdAt) : 'at an unknown time'}${plan.app ? ` with version ${plan.app}` : ''}. Tick what to put back. Services in the backup are added or replaced, and other services stay. History is joined with what’s here. Each other part replaces what’s here.`),
        h('div', { class: 'self-backup-parts' }, ...items),
        ...plan.notes.map((n) => h('div', { class: 'self-backup-warn' }, n)),
        h('div', { style: { marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } }, restoreBtn,
          h('span', { class: 'dim', style: { fontSize: '12px' } }, 'What it replaces is saved first, with the same passphrase.')));
    }

    function result(r) {
      return h('div', { class: 'self-backup-preview' },
        h('div', { class: 'section-title', style: { margin: '12px 0 6px' } }, 'Restored'),
        h('ul', { class: 'self-backup-list' }, ...r.restored.map((x) => h('li', {}, `${x.label}: ${x.detail}`))),
        r.refused.length ? h('div', {}, h('div', { class: 'section-title', style: { margin: '10px 0 6px' } }, 'Not restored'),
          h('ul', { class: 'self-backup-list' }, ...r.refused.map((x) => h('li', {}, `${x.label}: ${x.reason}`)))) : null,
        r.copy ? h('p', { style: { fontSize: '13px' } }, 'What it replaced is saved as ', h('span', { class: 'mono' }, r.copy), ' (same passphrase). ',
          h('button', { class: 'btn sm', onclick: () => { location.href = `/api/self-backup/copies/${encodeURIComponent(r.copy)}`; } }, 'Download that copy')) : null,
        h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '8px' } },
          h('button', { class: 'btn sm primary', onclick: () => location.reload() }, 'Reload now'),
          h('span', { class: 'dim', style: { fontSize: '12px' } }, 'Reload to see the restored settings. Nobody is signed out.')));
    }

    const copies = status.copies || [];
    return h('div', {},
      h('div', { class: 'section-title', style: { margin: '20px 0 6px' } }, 'Restore'),
      h('div', { class: 'self-backup-row' }, h('button', { class: 'btn sm', onclick: () => file.click() }, 'Choose file'), fileName, file),
      h('div', { class: 'self-backup-row', style: { marginTop: '8px' } }, p, open), msg, out,
      status.servicesIn === 'data' ? h('p', { class: 'dim', style: { fontSize: '12px' } }, 'config.json is read-only here, so restored services are saved in the data folder (services.json).') : null,
      copies.length ? h('details', { style: { marginTop: '12px' } }, h('summary', { class: 'dim', style: { cursor: 'pointer', fontSize: '13px' } }, `Copies saved before restoring (${copies.length})`),
        h('div', { class: 'list', style: { marginTop: '6px' } }, ...copies.map((c) => h('div', { class: 'row', style: { padding: '6px 12px' } },
          h('div', { class: 'row-main' }, h('div', { class: 'row-title', style: { fontSize: '13px' } }, when(c.at)), h('div', { class: 'meta-line', style: { fontSize: '12px' } }, h('span', { class: 'mono' }, c.name), h('span', {}, fmtBytes(c.size)))),
          h('div', { class: 'row-actions' }, h('button', { class: 'btn sm', onclick: () => { location.href = `/api/self-backup/copies/${encodeURIComponent(c.name)}`; } }, 'Download')))))) : null);
  }

  function paint() {
    mount(card,
      h('p', { class: 'dim settings-copy', style: { marginTop: 0 } }, 'One file with your services and their API keys, users and roles, two-factor and passkeys, notification channels and push devices, automation, links, everyone’s saved settings, and the history behind the disk forecast. It’s encrypted with a passphrase you choose. Without the passphrase the file can’t be opened, and nobody can recover it.'),
      h('p', { class: 'dim settings-copy' }, 'Not in the file: the sign-in settings, port and disks in config.json, and who’s signed in.'),
      makeBlock(), restoreBlock());
  }
  api.getJson('/api/self-backup').then((d) => { status = d; paint(); }).catch((e) => mount(card, h('p', { class: 'dim' }, e.message)));
  return card;
}
