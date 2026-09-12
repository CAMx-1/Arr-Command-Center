import { h, mount, spinner, empty, toast, fmtRelative, confirmModal } from './ui.js';

// Queue Cleaner + Hunting controls, rendered into Settings. Talks to the
// server automation endpoints (/api/automation*). Kept independent of any
// single service so it can live anywhere in the UI.

async function fetchJSON(url, opts) {
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}
function postJSON(url, body) { return fetchJSON(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); }

function toggle(label, checked, onChange) {
  const cb = h('input', { type: 'checkbox', checked: checked ? 'checked' : null });
  cb.addEventListener('change', () => onChange(cb.checked));
  return h('label', { class: 'setting-row', style: { cursor: 'pointer' } }, h('span', {}, label), h('span', { class: 'right' }, cb));
}
function numField(label, value, onChange, attrs = {}) {
  const inp = h('input', { class: 'input', type: 'number', value: String(value), style: { maxWidth: '120px' }, ...attrs });
  inp.addEventListener('change', () => onChange(Number(inp.value)));
  return h('label', { class: 'setting-row' }, h('span', {}, label), h('span', { class: 'right' }, inp));
}

export async function renderQueueCleaner(root) {
  mount(root, spinner());
  let status;
  try { status = await fetchJSON('/api/automation'); } catch (e) { return mount(root, empty('⚠️', 'Automation unavailable', e.message)); }
  const cfg = { ...status.config.queueCleaner };
  const save = async () => { try { await postJSON('/api/automation/config', { queueCleaner: cfg }); toast('Saved', 'success'); } catch (e) { toast(e.message, 'error'); } };
  const resultBox = h('div', { style: { marginTop: '14px' } });
  const renderResult = (r) => {
    if (!r.items || !r.items.length) { mount(resultBox, h('div', { class: 'dim', style: { padding: '10px 0' } }, `${r.dryRun ? 'Dry run: ' : ''}${r.checked} checked, ${r.flagged} flagged, ${r.removed} removed. Nothing to remove.`)); return; }
    mount(resultBox,
      h('div', { class: 'section-title' }, `${r.dryRun ? 'Dry run — ' : ''}${r.checked} checked · ${r.flagged} flagged · ${r.removed} removed`),
      h('div', { class: 'list' }, ...r.items.map((it) => h('div', { class: 'row' }, h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, it.title || it.svc),
        h('div', { class: 'meta-line', style: { marginTop: '4px' } },
          h('span', { class: 'pill muted' }, it.svc),
          h('span', { class: `pill ${it.action && it.action.includes('remov') ? 'down' : 'warn'}` }, it.action || 'flagged'),
          it.strikes ? h('span', {}, `strike ${it.strikes}/${it.max}`) : null,
          it.error ? h('span', { class: 'dim' }, it.error) : (it.reason ? h('span', { class: 'dim' }, it.reason) : null),
        ),
      )))),
    );
  };
  const run = async (dryRun) => { mount(resultBox, spinner()); try { const d = await postJSON('/api/automation/queue-cleaner/run', { dryRun }); renderResult(d.result); } catch (e) { mount(resultBox, h('div', { class: 'dim' }, e.message)); } };
  const lastRun = (status.runs && status.runs.queueCleaner) || null;

  mount(root,
    h('p', { class: 'dim', style: { margin: '0 0 12px', lineHeight: '1.6' } }, 'Flags stalled/errored downloads across all Sonarr/Radarr/Lidarr/Readarr instances, applies a strike each run, and removes them once they hit the strike limit.'),
    h('div', { class: 'pw-form' },
      toggle('Enabled (scheduled)', cfg.enabled, (v) => { cfg.enabled = v; }),
      toggle('Dry run (preview only, never removes)', cfg.dryRun, (v) => { cfg.dryRun = v; }),
      numField('Strikes before removal', cfg.maxStrikes, (v) => { cfg.maxStrikes = v; }, { min: '1', max: '20' }),
      numField('Run every (minutes)', cfg.intervalMinutes, (v) => { cfg.intervalMinutes = v; }, { min: '1' }),
      toggle('Remove from download client', cfg.removeFromClient, (v) => { cfg.removeFromClient = v; }),
      toggle('Add to blocklist (avoid re-grab)', cfg.blocklist, (v) => { cfg.blocklist = v; }),
    ),
    h('div', { class: 'meta-line', style: { marginTop: '12px' } },
      h('button', { class: 'btn primary', onclick: save }, 'Save'),
      h('button', { class: 'btn', onclick: () => run(true) }, 'Dry run now'),
      h('button', { class: 'btn danger', onclick: () => confirmModal({ title: 'Run Queue Cleaner', message: 'Run now and actually remove items that have reached the strike limit?', confirmLabel: 'Run', danger: true, onConfirm: () => run(false) }) }, 'Run now'),
    ),
    lastRun ? h('div', { class: 'dim', style: { marginTop: '10px' } }, `Last scheduled run: ${fmtRelative(lastRun.at)} — ${lastRun.summary}`) : null,
    resultBox,
  );
}

export async function renderHunting(root) {
  mount(root, spinner());
  let status;
  try { status = await fetchJSON('/api/automation'); } catch (e) { return mount(root, empty('⚠️', 'Automation unavailable', e.message)); }
  const cfg = { ...status.config.hunting };
  const save = async () => { try { await postJSON('/api/automation/config', { hunting: cfg }); toast('Saved', 'success'); } catch (e) { toast(e.message, 'error'); } };
  const resultBox = h('div', { style: { marginTop: '14px' } });
  const hRowMain = (it) => h('div', { class: 'row-main' },
    h('div', { class: 'meta-line' }, h('span', { class: 'pill muted' }, it.svc), it.error ? h('span', { class: 'pill down' }, 'error') : h('span', { class: 'pill ok' }, `${it.count} searched`), it.command ? h('span', { class: 'dim' }, it.command) : null, it.error ? h('span', { class: 'dim' }, it.error) : null));
  const run = async () => { mount(resultBox, spinner()); try { const d = await postJSON('/api/automation/hunt/run', {}); const r = d.result; mount(resultBox, h('div', { class: 'section-title' }, `Searched ${r.searched} item(s) across ${r.instances} instance(s)`), h('div', { class: 'list' }, ...(r.items || []).map((it) => h('div', { class: 'row' }, hRowMain(it))))); } catch (e) { mount(resultBox, h('div', { class: 'dim' }, e.message)); } };
  const modeSel = h('select', { class: 'input', style: { maxWidth: '160px' } }, ...['missing', 'cutoff', 'both'].map((m) => h('option', { value: m, selected: cfg.mode === m ? 'selected' : null }, m === 'missing' ? 'Missing' : m === 'cutoff' ? 'Cutoff upgrades' : 'Both')));
  modeSel.addEventListener('change', () => { cfg.mode = modeSel.value; });
  const lastRun = (status.runs && status.runs.hunting) || null;

  mount(root,
    h('p', { class: 'dim', style: { margin: '0 0 12px', lineHeight: '1.6' } }, 'Periodically triggers a search for wanted/missing (and optionally cutoff-unmet) items on each Sonarr/Radarr/Lidarr/Readarr instance.'),
    h('div', { class: 'pw-form' },
      toggle('Enabled (scheduled)', cfg.enabled, (v) => { cfg.enabled = v; }),
      h('label', { class: 'setting-row' }, h('span', {}, 'Search for'), h('span', { class: 'right' }, modeSel)),
      numField('Batch size per instance', cfg.batchSize, (v) => { cfg.batchSize = v; }, { min: '1', max: '50' }),
      numField('Run every (minutes)', cfg.intervalMinutes, (v) => { cfg.intervalMinutes = v; }, { min: '5' }),
    ),
    h('div', { class: 'meta-line', style: { marginTop: '12px' } },
      h('button', { class: 'btn primary', onclick: save }, 'Save'),
      h('button', { class: 'btn', onclick: run }, 'Run hunt now'),
    ),
    lastRun ? h('div', { class: 'dim', style: { marginTop: '10px' } }, `Last scheduled run: ${fmtRelative(lastRun.at)} — ${lastRun.summary}`) : null,
    resultBox,
  );
}
