// Bounded, fault-isolated batch runner for per-item bulk operations.
//
// Running a bulk action with `Promise.all(ids.map(...))` has two problems:
//   1. the first rejection aborts the whole batch (Promise.all short-circuits),
//      so one bad item hides the outcome of every other item; and
//   2. it fires every request at once — a 500-item search can open hundreds of
//      sockets and hammer the *arr instance.
//
// `runBatch` fixes both: it caps concurrency and never rejects. Every item
// resolves to a per-item record ({ ok, value | error }) in original order, so
// callers can show a progress bar, a per-item failure list, and a "retry
// failed" affordance. Pure/async and DOM-free so it can be unit-tested.

export const DEFAULT_CONCURRENCY = 4;

// runBatch(items, worker, { concurrency, onProgress })
//   worker(item, index) -> Promise<value>
//   onProgress({ done, total, last }) — fired after each item settles
// Resolves to [{ item, index, ok, value?, error? }] in original item order.
export async function runBatch(items, worker, { concurrency = DEFAULT_CONCURRENCY, onProgress } = {}) {
  const list = [...(items || [])];
  const total = list.length;
  const results = new Array(total);
  if (!total) return results;
  const limit = Math.max(1, Math.min(Number(concurrency) || DEFAULT_CONCURRENCY, total));
  let next = 0;
  let done = 0;

  const runOne = async () => {
    // Each worker pulls the next index until the queue is drained.
    for (let index = next++; index < total; index = next++) {
      const item = list[index];
      try {
        const value = await worker(item, index);
        results[index] = { item, index, ok: true, value };
      } catch (error) {
        results[index] = { item, index, ok: false, error };
      }
      done += 1;
      if (typeof onProgress === 'function') {
        try { onProgress({ done, total, last: results[index] }); } catch { /* progress is best-effort */ }
      }
    }
  };

  await Promise.all(Array.from({ length: limit }, runOne));
  return results;
}

// Reduce a runBatch result array to a summary with a normalized failure list.
export function summarizeBatch(results) {
  const list = (results || []).filter(Boolean);
  const failed = list.filter((r) => !r.ok);
  return {
    total: list.length,
    succeeded: list.length - failed.length,
    failed: failed.length,
    failures: failed.map((r) => ({
      item: r.item,
      index: r.index,
      error: r.error,
      message: (r.error && r.error.message) || String(r.error || 'Failed'),
    })),
  };
}

// Human-readable one-liner for a toast / summary line.
export function batchSummaryText(summary, noun = 'item') {
  const s = summary || { total: 0, succeeded: 0, failed: 0 };
  const plural = s.succeeded === 1 ? noun : `${noun}s`;
  if (!s.failed) return `${s.succeeded} ${plural} succeeded`;
  return `${s.succeeded} succeeded, ${s.failed} failed`;
}
