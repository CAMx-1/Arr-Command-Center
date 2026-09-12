import { h, mount } from '../lib/ui.js';

// Embeds the real service UI in an iframe. Only used for services that are NOT
// behind Cloudflare Access and don't send frame-blocking headers (verified for
// Overseerr). The browser talks to the service directly and keeps its own login
// session cookie — so you get the full native app with zero maintenance here.
export function renderEmbed(root, ctx) {
  const svc = ctx.service;
  const url = svc.embedUrl;

  ctx.setActions(
    h('button', { class: 'btn', onclick: () => { const f = document.getElementById('embed-frame'); if (f) f.src = f.src; } }, '↻ Reload'),
    h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener' }, '↗ Open in new tab'),
  );

  const frame = h('iframe', {
    id: 'embed-frame',
    class: 'embed-frame',
    src: url,
    referrerpolicy: 'no-referrer',
    allow: 'fullscreen; clipboard-read; clipboard-write',
  });

  const note = h('div', { class: 'embed-note' },
    h('span', {}, `Embedded from ${url}`),
    h('span', { class: 'dim' }, ' — log in to the service once; it keeps its own session.'),
  );

  mount(root, h('div', { class: 'embed-wrap' }, note, frame));
}
