// TRaSH Guides sync: load a TRaSH profile, preview, and apply to Sonarr/Radarr.
import { buildSyncPlan, applyScores } from './trashPlan.js';

export async function loadTrashProfiles(app, fetchImpl = (...a) => fetch(...a)) {
  const r = await fetchImpl(`/api/trash/${app}/profiles`);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

export async function previewTrashSync(arr, { app, slug, profileId = null, fetchImpl = (...a) => fetch(...a) }) {
  const r = await fetchImpl(`/api/trash/${app}/profile/${encodeURIComponent(slug)}`);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  const [arrFormats, profiles] = await Promise.all([arr.get('customformat'), arr.get('qualityprofile')]);
  const arrProfile = profileId == null ? null : (profiles || []).find((p) => p.id === Number(profileId)) || null;
  const cfs = new Map((d.formats || []).map((c) => [c.trash_id, c]));
  return { plan: buildSyncPlan({ trashProfile: d.profile, cfs, arrFormats, arrProfile }), arrProfile, profiles };
}

// selected: Set of trash_ids to apply (formats and their scores).
export async function applyTrashSync(arr, { plan, arrProfile, selected }) {
  const result = { created: [], updated: [], failed: [], scored: false };
  for (const f of plan.formats) {
    if (!selected.has(f.trashId) || f.action === 'same') continue;
    try {
      if (f.action === 'create') result.created.push((await arr.post('customformat', f.format)).name);
      else { await arr.put(`customformat/${f.existingId}`, { ...f.format, id: f.existingId }); result.updated.push(f.name); }
    } catch (e) { result.failed.push({ name: f.name, error: errorText(e) }); }
  }
  if (arrProfile) {
    // Re-read: new formats get ids, and the app adds them to every profile.
    const [formats, fresh] = await Promise.all([arr.get('customformat'), arr.get(`qualityprofile/${arrProfile.id}`).catch(() => null)]);
    const base = fresh || (await arr.get('qualityprofile')).find((p) => p.id === arrProfile.id);
    const ids = new Map((formats || []).map((f) => [String(f.name).toLowerCase(), f.id]));
    try { await arr.put(`qualityprofile/${arrProfile.id}`, applyScores(base, plan, ids, { selected })); result.scored = true; }
    catch (e) { result.failed.push({ name: `scores on ${arrProfile.name}`, error: errorText(e) }); }
  }
  return result;
}

function errorText(e) {
  const d = e && e.data;
  if (Array.isArray(d) && d[0] && d[0].errorMessage) return d.map((x) => x.errorMessage).join('; ');
  return (d && d.message) || (e && e.message) || 'failed';
}
