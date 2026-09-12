// Per-service dedup for queue "needs attention" notifications.
//
// `state` is a Map keyed by a service key; each value is a Set of the issue
// keys that were "bad" on the previous poll. On every poll we reconcile that
// against the keys that are bad RIGHT NOW:
//   • emit only keys that are newly bad (weren't bad last poll),
//   • keep the stored Set bounded to exactly the currently-bad keys, and
//   • drop the service's entry entirely when nothing is bad.
//
// This bounds memory (state never grows past the live queue), lets a recurring
// issue notify again after it clears, and — because each service key owns its
// own Set and reconcile only touches that one entry — keeps multiple service
// instances fully isolated from one another.
//
// Returns the array of newly-bad keys that should be emitted (deduped, in the
// order they first appear in `badKeys`).
export function reconcileQueueIssues(state, serviceKey, badKeys) {
  const prev = state.get(serviceKey) || new Set();
  const next = new Set();
  const emit = [];
  for (const k of badKeys) {
    if (next.has(k)) continue; // dedupe within this poll
    next.add(k);
    if (!prev.has(k)) emit.push(k);
  }
  if (next.size) state.set(serviceKey, next);
  else state.delete(serviceKey); // queue empty / recovered — clear so it can re-emit later
  return emit;
}
