// Host system stats for the optional Overview "system monitor" hexes:
// CPU utilisation, memory, per-disk usage, and network throughput. Everything
// is best-effort and degrades gracefully (e.g. network is Linux-only via
// /proc/net/dev; disks that can't be stat'd return an error field).
import os from 'node:os';
import fsp from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clampPct = (n) => Math.max(0, Math.min(100, Math.round(n)));
const execFileAsync = promisify(execFile);

let containerizedCache;
async function isContainerized() {
  if (containerizedCache !== undefined) return containerizedCache;
  try {
    await fsp.access('/.dockerenv');
    containerizedCache = true;
  } catch {
    try { await fsp.access('/run/.containerenv'); containerizedCache = true; }
    catch { containerizedCache = false; }
  }
  return containerizedCache;
}

function cpuTimes() {
  let idle = 0; let total = 0;
  for (const c of os.cpus() || []) {
    for (const k of Object.keys(c.times)) total += c.times[k];
    idle += c.times.idle;
  }
  return { idle, total };
}

// Instantaneous CPU% over a short sampling window (no persistent state needed).
async function cpuPercent(windowMs = 120) {
  const a = cpuTimes();
  await sleep(windowMs);
  const b = cpuTimes();
  const dt = b.total - a.total;
  const di = b.idle - a.idle;
  if (dt <= 0) return 0;
  return clampPct((1 - di / dt) * 100);
}

async function dfUsageMap() {
  // Docker Desktop's grpcfuse reports f_bsize=1 MiB to statfs while its block
  // counts are in 4 KiB units, inflating Node statfs capacities by 256x. POSIX
  // df uses the filesystem fragment size and returns correct 1 KiB counts.
  // Query every mount once and match the exact target: `df <path>` can select
  // the first grpcfuse bind when several binds share the same synthetic device.
  const { stdout } = await execFileAsync('/bin/df', ['-Pk'], {
    encoding: 'utf8', timeout: 5000, maxBuffer: 256 * 1024,
  });
  const usages = new Map();
  for (const line of stdout.trim().split('\n').slice(1)) {
    const match = line.match(/^\S+\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/);
    if (!match) continue;
    const total = Number(match[1]) * 1024;
    const free = Number(match[3]) * 1024;
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(free)) continue;
    const used = Math.max(0, total - free);
    usages.set(match[5], { total, free, used, percent: clampPct((used / total) * 100) });
  }
  return usages;
}

async function statfsUsage(path) {
  const s = await fsp.statfs(path);
  const bsize = Number(s.bsize) || 0;
  const total = Number(s.blocks) * bsize;
  const free = Number(s.bavail) * bsize;      // space available to unprivileged users
  const used = Math.max(0, total - free);
  return { path, total, free, used, percent: total ? clampPct((used / total) * 100) : 0 };
}

async function diskUsage(paths, { containerized = false } = {}) {
  const list = (Array.isArray(paths) && paths.length) ? paths : [];
  let df = null;
  if (containerized && process.platform !== 'win32' && list.length) {
    try { df = await dfUsageMap(); } catch { /* statfs fallback below */ }
  }
  return Promise.all(list.map(async (path) => {
    try {
      const fromDf = df && df.get(path);
      if (fromDf) return { path, ...fromDf };
      return await statfsUsage(path);
    } catch (e) {
      return { path, error: e.code || e.message || 'unavailable' };
    }
  }));
}

// Network throughput (bytes/sec) from /proc/net/dev deltas. Linux-only; returns
// null elsewhere so the UI can hide the network hex.
let prevNet = null;
async function networkThroughput() {
  let txt;
  try { txt = await fsp.readFile('/proc/net/dev', 'utf8'); }
  catch { return null; } // not Linux / not available
  let rx = 0; let tx = 0;
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([^:]+):\s*(.*)$/);
    if (!m) continue;
    const iface = m[1].trim();
    if (iface === 'lo') continue; // skip loopback
    const cols = m[2].trim().split(/\s+/).map(Number);
    rx += cols[0] || 0;   // bytes received
    tx += cols[8] || 0;   // bytes transmitted
  }
  const now = Date.now();
  let rxSec = null; let txSec = null;
  if (prevNet) {
    const dt = (now - prevNet.at) / 1000;
    if (dt > 0) {
      rxSec = Math.max(0, (rx - prevNet.rx) / dt);
      txSec = Math.max(0, (tx - prevNet.tx) / dt);
    }
  }
  prevNet = { rx, tx, at: now };
  return { rxSec, txSec, totalRx: rx, totalTx: tx };
}

// Default filesystem root for the current platform (fallback when we can't
// enumerate mounts, e.g. unsupported platforms).
function defaultRoot() { return process.platform === 'win32' ? `${process.env.SystemDrive || 'C:'}\\` : '/'; }

// Enumerate real (non-pseudo) Linux mount points from /proc/mounts.
// Docker injects several *file* mounts (/etc/hosts, hostname, resolv.conf), and
// this app commonly bind-mounts config/data beneath /app. Neither represents a
// host disk the user can select, so auto-discovery keeps accessible directories
// only and hides app-internal mounts when running in a container. Explicit
// config.system.disks / SYSTEM_DISKS paths still bypass this discovery filter.
async function listLinuxMounts(containerized) {
  let txt;
  try { txt = await fsp.readFile('/proc/mounts', 'utf8'); }
  catch { return null; }
  const seen = new Set();
  const candidates = [];
  for (const line of txt.split('\n')) {
    const [dev, rawMnt, type] = line.split(/\s+/);
    if (!dev || !rawMnt) continue;
    // Real block devices + network shares only; skip pseudo/virtual filesystems.
    const isReal = dev.startsWith('/dev/') || /^(nfs|nfs4|cifs|smb3?|fuse\.)/.test(type || '');
    if (!isReal) continue;
    const mnt = rawMnt.replace(/\\040/g, ' ').replace(/\\011/g, '\t');
    if (mnt.startsWith('/boot') || mnt.startsWith('/snap') || seen.has(mnt)) continue;
    if (containerized && (mnt === '/app' || mnt.startsWith('/app/'))) continue;
    seen.add(mnt);
    candidates.push(mnt);
  }

  const checked = await Promise.all(candidates.map(async (mnt) => {
    try { return (await fsp.stat(mnt)).isDirectory() ? mnt : null; }
    catch { return null; }
  }));
  const mounts = checked.filter(Boolean);
  mounts.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return mounts;
}

// macOS exposes user-visible mounted disks and disk images beneath /Volumes.
// A plain directory (and the usual "Macintosh HD" symlink back to /) has the
// same device id as /Volumes; a real mount boundary has a different id. This
// avoids shelling out to `mount` and excludes stale/ordinary directories while
// retaining external disks, network volumes, and mounted images.
async function listMacMounts() {
  const volumesDir = '/Volumes';
  let entries; let parent;
  try {
    [entries, parent] = await Promise.all([
      fsp.readdir(volumesDir, { withFileTypes: true }),
      fsp.stat(volumesDir),
    ]);
  } catch { return null; }

  const mounts = ['/'];
  await Promise.all(entries.map(async (entry) => {
    if (!entry.name || entry.name.startsWith('.')) return;
    const mountPath = `${volumesDir}/${entry.name}`;
    try {
      const stat = await fsp.stat(mountPath);
      if (stat.isDirectory() && stat.dev !== parent.dev) mounts.push(mountPath);
    } catch { /* volume may have been unmounted while enumerating */ }
  }));
  mounts.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return mounts;
}

async function listMounts(containerized) {
  if (process.platform === 'linux') return listLinuxMounts(containerized);
  if (process.platform === 'darwin') return listMacMounts();
  return null;
}

// Resolve which disk paths to report: an explicit list when provided (config /
// env), otherwise every discovered mount, otherwise the filesystem root. An
// unconfigured container with no host-directory binds reports no disks instead
// of presenting its ephemeral overlay filesystem as if it were the host.
async function resolveDiskPaths(disks, containerized) {
  if (Array.isArray(disks) && disks.length) return disks.slice(0, 24);
  const mounts = await listMounts(containerized);
  if (mounts && mounts.length) return mounts.slice(0, 24);
  if (containerized && process.platform === 'linux') return [];
  return [defaultRoot()];
}

export async function getSystemStats({ disks } = {}) {
  const containerized = await isContainerized();
  const paths = await resolveDiskPaths(disks, containerized);
  const [cpu, disksOut, net] = await Promise.all([
    cpuPercent(),
    diskUsage(paths, { containerized }),
    networkThroughput(),
  ]);
  const total = os.totalmem();
  const free = os.freemem();
  const used = Math.max(0, total - free);
  const load = os.loadavg(); // [1, 5, 15] — all 0 on platforms without load avg
  return {
    at: Date.now(),
    containerized,
    cpu: { percent: cpu, cores: (os.cpus() || []).length, load },
    mem: { total, free, used, percent: total ? clampPct((used / total) * 100) : 0 },
    disks: disksOut,
    net,
  };
}

// Reset sampling state (tests).
export function _resetSystemState() { prevNet = null; }
