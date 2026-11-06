// Current total download speed across every connected download client, in
// bytes per second. Clients that fail to answer are skipped and listed.
import { downloadClientFor } from './downloadClients.js';

const CLIENTS = new Set(['sabnzbd', 'qbittorrent', 'transmission', 'deluge', 'nzbget', 'flood']);

export async function currentDownloadSpeed(api, services) {
  const list = (services || []).filter((s) => CLIENTS.has(s.type) && s.configured !== false);
  const per = await Promise.all(list.map(async (svc) => {
    try {
      if (svc.type === 'sabnzbd') {
        const q = ((await api.sab(svc.key, { mode: 'queue' })) || {}).queue || {};
        return { svc, bps: q.status === 'Paused' ? 0 : (Number(q.kbpersec) || 0) * 1024 };
      }
      if (svc.type === 'qbittorrent') return { svc, bps: Number(((await api.qbit(svc.key).get('transfer/info')) || {}).dl_info_speed) || 0 };
      const data = await downloadClientFor(api, svc).load(svc.type === 'nzbget' ? 'queue' : 'active');
      return { svc, bps: Number(data.session && data.session.dlSpeed) || 0 };
    } catch (e) { return { svc, bps: 0, error: e.message }; }
  }));
  return { total: per.reduce((s, x) => s + x.bps, 0), clients: per };
}
