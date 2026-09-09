// Host system stats for the optional Overview "system monitor" hexes:
// CPU utilisation, memory, per-disk usage, and network throughput. Everything
// is best-effort and degrades gracefully (e.g. network is Linux-only via
// /proc/net/dev; disks that can't be stat'd return an error field).
import os from 'node:os';
import fsp from 'node:fs/promises';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clampPct = (n) => Math.max(0, Math.min(100, Math.round(n)));

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

async function diskUsage(paths) {
  const list = (Array.isArray(paths) && paths.length) ? paths : [];
  return Promise.all(list.map(async (p) => {
    try {
      const s = await fsp.statfs(p);
      const bsize = Number(s.bsize) || 0;
      const total = Number(s.blocks) * bsize;
      const free = Number(s.bavail) * bsize;      // space available to unprivileged users
      const used = Math.max(0, total - free);
      return { path: p, total, free, used, percent: total ? clampPct((used / total) * 100) : 0 };
    } catch (e) {
      return { path: p, error: e.code || e.message || 'unavailable' };
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

export async function getSystemStats({ disks = [] } = {}) {
  const [cpu, disksOut, net] = await Promise.all([
    cpuPercent(),
    diskUsage(disks),
    networkThroughput(),
  ]);
  const total = os.totalmem();
  const free = os.freemem();
  const used = Math.max(0, total - free);
  const load = os.loadavg(); // [1, 5, 15] — all 0 on platforms without load avg
  return {
    at: Date.now(),
    cpu: { percent: cpu, cores: (os.cpus() || []).length, load },
    mem: { total, free, used, percent: total ? clampPct((used / total) * 100) : 0 },
    disks: disksOut,
    net,
  };
}

// Reset sampling state (tests).
export function _resetSystemState() { prevNet = null; }
