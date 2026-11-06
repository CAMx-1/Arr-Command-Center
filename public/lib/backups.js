// Back up every *arr app at once: run each app's own Backup command, wait for
// it, then list the backups it holds so they can be downloaded. The zips are
// made and kept by the apps themselves; nothing is written to the drives by
// Arr Command Center.

export const BACKUP_TYPES = { sonarr: 'v3', radarr: 'v3', whisparr: 'v3', lidarr: 'v1', readarr: 'v1', prowlarr: 'v1' };

export function backupTargets(services) {
  return (services || []).filter((s) => BACKUP_TYPES[s.type] && s.configured !== false);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newest = (list) => (list || []).slice().sort((a, b) => String(b.time).localeCompare(String(a.time)));

// proxy(serviceKey, path, { method, body }) -> parsed JSON (api.proxy)
export async function listBackups(proxy, svc) {
  return newest(await proxy(svc.key, `api/${BACKUP_TYPES[svc.type]}/system/backup`));
}

export async function runBackup(proxy, svc, { wait = sleep, pollMs = 1500, timeoutMs = 120000 } = {}) {
  const v = BACKUP_TYPES[svc.type];
  const before = new Set((await listBackups(proxy, svc)).map((b) => b.name));
  const cmd = await proxy(svc.key, `api/${v}/command`, { method: 'POST', body: { name: 'Backup' } });
  let status = cmd && cmd.status;
  for (let t = 0; cmd && cmd.id != null && !['completed', 'failed', 'aborted', 'cancelled'].includes(status) && t < timeoutMs; t += pollMs) {
    await wait(pollMs);
    const c = await proxy(svc.key, `api/${v}/command/${cmd.id}`).catch(() => null);
    status = c ? c.status : status;
    if (status === 'failed') throw new Error((c && (c.message || c.exception)) || 'Backup failed');
  }
  const after = await listBackups(proxy, svc);
  const made = after.find((b) => !before.has(b.name));
  if (!made) throw new Error(status === 'completed' ? 'Backup finished but no new file showed up' : 'Timed out waiting for the backup');
  return { backup: made, backups: after };
}

// Runs all apps in parallel; one failing doesn't stop the others.
export async function backUpAll(proxy, services, { onResult = () => {}, ...opts } = {}) {
  return Promise.all(backupTargets(services).map(async (svc) => {
    let r;
    try { r = { svc, ok: true, ...(await runBackup(proxy, svc, opts)) }; }
    catch (e) { r = { svc, ok: false, error: e.message }; }
    onResult(r);
    return r;
  }));
}

// Backups are downloaded in the app itself (Sonarr/Radarr only serve the zip
// to their own web login). This opens its System → Backup page.
export function backupPageUrl(serviceKey) {
  return `/api/backups/${encodeURIComponent(serviceKey)}/open`;
}
