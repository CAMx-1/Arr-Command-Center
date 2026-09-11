// Normalize Seerr request state for Overview list and hex badges. Availability
// wins over request workflow state: once media is available it should no longer
// look like a generic grey request, even when rendered from a cached snapshot.
export function seerrRequestBadge(entry) {
  if (entry?.kind !== 'seerr-request') return null;
  const availability = Number(entry.media?.availability);
  if (availability === 5 || entry.availabilityLabel === 'Available') {
    return { label: 'Available', cls: 'ok' };
  }
  if (entry.action?.type === 'overseerr-request') {
    return { label: 'Pending', cls: 'warn' };
  }
  return { label: 'Request', cls: 'muted' };
}
