// "Your <year> in review is ready": a push notification once a year, in
// December, to the people with push turned on who watched something that
// year (at least an hour, matched to Tautulli like the year in review is).
// Category "recap", which people can turn off with the other categories.
import { matchTautulliUser } from './yearReview.js';

const NS = 'recapNotice';
export const MIN_SECONDS = 3600;
export const FROM_HOUR = 10; // not in the middle of the night

// Whether it's time to send this year's notice. `now` is the server's local time.
export function noticeDue(now, last) {
  if (now.getMonth() !== 11 || now.getHours() < FROM_HOUR) return null;
  const year = now.getFullYear();
  return last && last.year === year ? null : year;
}

// Which push subscriptions get it. With Sign in with Plex, each device is
// matched to its person; otherwise (one shared sign-in) every device gets it
// if anyone watched enough.
export function recipients(subs, people, { perPerson }) {
  const keen = (people || []).filter((p) => p.seconds >= MIN_SECONDS);
  if (!perPerson) return keen.length ? subs.slice() : [];
  return subs.filter((sub) => (sub.user || sub.email) && matchTautulliUser(keen, { user: sub.user, email: sub.email }));
}

export function noticeMessage(year) {
  return {
    title: `Your ${year} in review is ready`,
    body: 'Hours watched, top shows and films, your busiest night. Tap to look back at your year.',
    url: `/#/home?recap=${year}&play=1`,
    tag: `recap:${year}`,
  };
}

// getPeople(year) → Tautulli people with seconds watched (throws if
// Tautulli can't be read: then it tries again later).
export function createRecapNotice({ store, getPeople, listSubscriptions, send, categoryEnabled, perPerson, now = () => new Date(), log = () => {} }) {
  let running = false;
  async function tick() {
    if (running) return { skipped: 'busy' };
    const year = noticeDue(now(), store.get(NS, null));
    if (!year) return { skipped: 'not due' };
    // Not marked as sent: if the category is turned on, or a device signs up
    // for push, later in December, it still goes out.
    if (!categoryEnabled('recap')) return { skipped: 'category off' };
    const subs = listSubscriptions();
    if (!subs.length) return { skipped: 'no devices' };
    running = true;
    try {
      let people;
      try { people = await getPeople(year); } catch (e) { log({ ok: false, year, error: e.message }); return { skipped: 'tautulli', error: e.message }; }
      const to = recipients(subs, people, { perPerson: perPerson() });
      const endpoints = new Set(to.map((s) => s.endpoint));
      if (to.length) await send(noticeMessage(year), (sub) => endpoints.has(sub.endpoint));
      store.set(NS, { year, at: Date.now(), sent: to.length });
      log({ ok: true, year, sent: to.length });
      return { sent: to.length, year };
    } finally { running = false; }
  }
  return { tick };
}
