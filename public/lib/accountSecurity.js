// Settings → You → "Sign-in & security": two-factor codes for admins and the
// list of browsers signed in to your account (and, for admins, everyone's).
import { h, mount, toast, fmtRelative, copyable } from './ui.js';
import { api } from './api.js';

const when = (ms) => fmtRelative(new Date(ms).toISOString());

export function accountSecurityCard() {
  const card = h('div', { class: 'card', id: 'security-panel' }, h('div', { class: 'dim' }, 'Loading…'));
  const call = (path, body, method) => api.sendJson(`/api/account${path}`, body || {}, method);
  let data = null;
  const load = async () => {
    try { data = await api.getJson('/api/account'); } catch (e) { mount(card, h('div', { class: 'dim' }, e.message)); return; }
    paint();
  };
  const refreshSummary = () => card.dispatchEvent(new CustomEvent('sx:refresh', { bubbles: true }));
  const update = (d) => { if (d && d.sessions) data = { ...data, ...d }; paint(); refreshSummary(); };

  // Inline "enter a code" prompt used by turn-off and new recovery codes.
  function codePrompt(label, run) {
    const input = h('input', { class: 'input', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: 'Code from your app, or a recovery code', style: { flex: '1', minWidth: '200px' } });
    const go = h('button', { class: 'btn sm primary', onclick: async () => { go.disabled = true; try { await run(input.value.trim()); } catch (e) { toast(e.message, 'error'); } go.disabled = false; } }, label);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
    setTimeout(() => input.focus(), 0);
    return h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' } }, input, go);
  }
  function showRecovery(codes, slot) {
    const text = codes.join('\n');
    mount(slot, h('div', { class: 'card', style: { marginTop: '10px', background: 'var(--surface-2, rgba(0,0,0,0.03))' } },
      h('b', {}, 'Recovery codes'),
      h('p', { class: 'dim', style: { fontSize: '12px', margin: '4px 0 8px' } }, 'Each one works once if you lose your phone. Save them somewhere safe now; they won’t be shown again.'),
      h('div', { class: 'mono', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '4px', fontSize: '14px' } }, ...codes.map((c) => h('span', {}, c))),
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } }, h('span', {}, copyable(text, 'Copy all')), h('button', { class: 'btn sm', onclick: () => mount(slot) }, 'I’ve saved them'))));
  }

  function twoFactorBlock() {
    const tf = data.twoFactor;
    const slot = h('div', {});
    if (!tf.canEnroll) return null;
    if (!tf.enabled) {
      const start = h('button', { class: 'btn sm primary', onclick: async () => {
        start.disabled = true;
        try {
          const r = await call('/2fa/start');
          const groups = r.secret.match(/.{1,4}/g).join(' ');
          mount(slot,
            h('ol', { style: { fontSize: '13px', paddingLeft: '18px', margin: '10px 0' } },
              h('li', {}, 'Open your authenticator app (1Password, iOS Passwords, Google Authenticator, Authy, …) and add an account. ',
                h('a', { href: r.otpauth }, 'Open in authenticator app'), ' works on the phone that has the app.'),
              h('li', {}, 'Or type this key: ', h('span', { class: 'mono' }, copyable(r.secret, groups)), ' (time-based, 6 digits)'),
              h('li', {}, 'Enter the code it shows to finish.')),
            codePrompt('Turn on', async (code) => {
              const d = await call('/2fa/confirm', { code });
              update(d);
              toast(d.removed ? `Two-factor is on. Signed out ${d.removed} other ${d.removed === 1 ? 'session' : 'sessions'}.` : 'Two-factor is on', 'success', 5000);
              showRecovery(d.recoveryCodes, card.querySelector('#tf-slot'));
            }));
        } catch (e) { toast(e.message, 'error'); start.disabled = false; }
      } }, 'Turn on two-factor');
      return h('div', {},
        h('div', { class: 'section-title', style: { margin: '0 0 4px' } }, 'Two-factor sign-in'),
        h('p', { class: 'dim settings-copy' }, 'After Plex, ask for a code from an app on your phone. If someone gets into your Plex account, they still can’t open this dashboard as you. Other browsers signed in to your account are signed out when you turn it on.'),
        start, slot);
    }
    const off = h('button', { class: 'btn sm danger', onclick: () => mount(action, codePrompt('Turn off', async (code) => { update(await call('/2fa/disable', { code })); toast('Two-factor is off', 'warn'); })) }, 'Turn off');
    const fresh = h('button', { class: 'btn sm', onclick: () => mount(action, codePrompt('Make new codes', async (code) => { const d = await call('/2fa/recovery', { code }); update(d); showRecovery(d.recoveryCodes, card.querySelector('#tf-slot')); })) }, 'New recovery codes');
    const action = h('div', {});
    return h('div', {},
      h('div', { class: 'section-title', style: { margin: '0 0 4px' } }, 'Two-factor sign-in'),
      h('p', { class: 'settings-copy', style: { margin: '0 0 8px' } }, h('span', { class: 'pill ok' }, 'On'), ` since ${when(tf.enabledAt)} · ${tf.recoveryLeft} recovery ${tf.recoveryLeft === 1 ? 'code' : 'codes'} left`,
        tf.recoveryLeft <= 2 ? h('span', { class: 'pill warn', style: { marginLeft: '6px' } }, 'running low') : null),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, fresh, off), action);
  }

  function sessionRow(x, showUser) {
    const out = h('button', { class: 'btn sm', onclick: async () => {
      if (out.dataset.armed !== '1') { out.dataset.armed = '1'; out.textContent = x.current ? 'Sign out here?' : 'Sign out?'; return; }
      try {
        const d = await call(`/sessions/${encodeURIComponent(x.id)}`, null, 'DELETE');
        if (d.signedOut) { location.href = '/'; return; }
        update(d); toast(`Signed out ${showUser ? `${x.user} on ` : ''}${x.device}`, 'success');
      } catch (e) { toast(e.message, 'error'); }
    } }, 'Sign out');
    return h('div', { class: 'row' },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title', style: { fontSize: '14px' } }, showUser ? `${x.user} · ` : '', x.device, ' ',
          x.current ? h('span', { class: 'pill info' }, 'this browser') : null, ' ', x.mfa ? h('span', { class: 'pill muted' }, 'two-factor') : null),
        h('div', { class: 'meta-line' }, h('span', {}, `active ${when(x.lastSeen)}`), h('span', {}, `signed in ${when(x.created)}`), x.ip ? h('span', { class: 'mono' }, x.ip) : null)),
      h('div', { class: 'row-actions' }, out));
  }

  function paint() {
    if (!data.plexAuth) {
      mount(card, h('p', { class: 'dim settings-copy' }, 'Two-factor sign-in and the session list need Sign in with Plex (auth.plex.enabled in config.json). With Basic auth, browsers keep the password; change it in config.json to sign everyone out.'));
      return;
    }
    const mine = data.sessions || [];
    const others = mine.filter((x) => !x.current).length;
    const everyone = (data.everyone || []).filter((x) => x.user.toLowerCase() !== String(data.user).toLowerCase());
    mount(card,
      twoFactorBlock(), h('div', { id: 'tf-slot' }),
      h('div', { class: 'section-title', style: { margin: '18px 0 4px', display: 'flex', alignItems: 'center', gap: '8px' } }, 'Where you’re signed in', h('span', { style: { flex: '1' } }),
        others ? h('button', { class: 'btn sm', onclick: async () => { try { const d = await call('/sessions/others'); update(d); toast(`Signed out ${d.removed} other ${d.removed === 1 ? 'session' : 'sessions'}`, 'success'); } catch (e) { toast(e.message, 'error'); } } }, 'Sign out everywhere else') : null),
      mine.length ? h('div', { class: 'list' }, ...mine.map((x) => sessionRow(x, false))) : h('p', { class: 'dim' }, 'No sessions.'),
      everyone.length ? h('details', { style: { marginTop: '16px' } }, h('summary', { style: { cursor: 'pointer', fontWeight: '600' } }, `Other people’s sessions (${everyone.length})`),
        h('div', { class: 'list', style: { marginTop: '8px' } }, ...everyone.map((x) => sessionRow(x, true)))) : null);
  }
  load();
  return card;
}
