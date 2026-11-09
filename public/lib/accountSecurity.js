// Settings → You → "Sign-in & security": two-factor codes for admins and the
// list of browsers signed in to your account (and, for admins, everyone's).
import { h, mount, toast, fmtRelative, copyable } from './ui.js';
import { api } from './api.js';
import { qrSvg } from './qr.js';
import { passkeyProblem, createPasskey, withVerification } from './passkeys.js';

const defaultPasskeyName = () => { const u = navigator.userAgent; return /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Mac OS X/.test(u) ? 'Mac' : /Android/.test(u) ? 'Android phone' : /Windows/.test(u) ? 'Windows PC' : 'This device'; };

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
    const problem = passkeyProblem();
    // A call that may need "Confirm it's you" first.
    const guarded = (fn, reason) => withVerification(fn, reason).catch((e) => { if (!e.cancelled) toast(e.message, 'error', 6000); return null; });

    const setupApp = async (btn) => {
      btn.disabled = true;
      const r = await guarded(() => call('/2fa/start'), 'Confirm it’s you to add an authenticator app.');
      btn.disabled = false;
      if (!r) return;
      const groups = r.secret.match(/.{1,4}/g).join(' ');
      mount(slot,
        h('div', { style: { display: 'flex', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap', margin: '10px 0' } },
          h('div', { class: 'tf-qr', title: 'Scan with your authenticator app', html: qrSvg(r.otpauth, { ecl: 'M', scale: 3, title: 'Two-factor setup code' }), style: { background: '#fff', padding: '6px', borderRadius: '8px', lineHeight: '0' } }),
          h('ol', { style: { fontSize: '13px', paddingLeft: '18px', margin: '0', flex: '1', minWidth: '240px' } },
            h('li', {}, 'In your authenticator app (1Password, iOS Passwords, Google Authenticator, Authy, …) add an account and scan this code. ',
              'On the phone that has the app, ', h('a', { href: r.otpauth }, 'open it in the app'), ' instead.'),
            h('li', {}, 'Or type this key: ', h('span', { class: 'mono' }, copyable(r.secret, groups)), ' (time-based, 6 digits)'),
            h('li', {}, 'Enter the code it shows to finish.'))),
        codePrompt('Turn on', async (code) => {
          const d = await call('/2fa/confirm', { code });
          update(d);
          toast(d.recoveryCodes ? (d.removed ? `Two-factor is on. Signed out ${d.removed} other ${d.removed === 1 ? 'session' : 'sessions'}.` : 'Two-factor is on') : 'Authenticator app added', 'success', 5000);
          if (d.recoveryCodes) showRecovery(d.recoveryCodes, card.querySelector('#tf-slot'));
        }));
    };
    const addPasskey = async (btn) => {
      btn.disabled = true;
      try {
        const opts = await withVerification(() => call('/passkeys/options'), 'Confirm it’s you to add a passkey.');
        const credential = await createPasskey(opts);
        const name = (prompt('A name for this passkey (so you can tell them apart):', defaultPasskeyName()) || '').trim();
        const d = await call('/passkeys', { credential, name });
        update(d);
        toast(d.recoveryCodes ? (d.removed ? `Passkey added and two-factor is on. Signed out ${d.removed} other ${d.removed === 1 ? 'session' : 'sessions'}.` : 'Passkey added and two-factor is on') : `Added “${d.added.name}”`, 'success', 6000);
        if (d.recoveryCodes) showRecovery(d.recoveryCodes, card.querySelector('#tf-slot'));
      } catch (e) { if (!e.cancelled) toast(e.message, 'error', 6000); }
      btn.disabled = false;
    };
    const removePasskey = (pk, btn) => async () => {
      if (btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.textContent = 'Remove?'; return; }
      const last = !tf.totp && tf.passkeys.length === 1;
      const d = await guarded(() => api.sendJson(`/api/account/passkeys/${encodeURIComponent(pk.id)}`, {}, 'DELETE'), last ? 'This is your last passkey: removing it turns two-factor off. Confirm it’s you.' : 'Confirm it’s you to remove this passkey.');
      if (d) { update(d); toast(last ? 'Passkey removed; two-factor is off' : `Removed “${pk.name}”`, 'warn'); }
    };

    const appBtn = h('button', { class: `btn sm${tf.enabled ? '' : ' primary'}`, onclick: () => setupApp(appBtn) }, tf.enabled ? 'Add an authenticator app' : 'Use an authenticator app');
    const pkBtn = h('button', { class: 'btn sm', disabled: problem ? 'disabled' : null, title: problem || '', onclick: () => addPasskey(pkBtn) }, 'Add a passkey');
    const passkeyList = tf.passkeys.length ? h('div', { class: 'list', style: { margin: '8px 0' } }, ...tf.passkeys.map((pk) => {
      const rm = h('button', { class: 'btn sm danger' }, 'Remove'); rm.onclick = removePasskey(pk, rm);
      return h('div', { class: 'row', style: { padding: '6px 12px' } },
        h('div', { class: 'row-main' }, h('div', { class: 'row-title', style: { fontSize: '13px' } }, pk.name, ' ', pk.synced ? h('span', { class: 'pill muted' }, 'synced') : null, pk.rpId !== tf.passkeyDomain ? h('span', { class: 'pill warn', style: { marginLeft: '4px' } }, `for ${pk.rpId}`) : null),
          h('div', { class: 'meta-line', style: { fontSize: '12px' } }, h('span', {}, `added ${when(pk.createdAt)}`), h('span', { class: 'dim' }, pk.lastUsedAt ? `used ${when(pk.lastUsedAt)}` : 'not used yet'))),
        h('div', { class: 'row-actions' }, rm));
    })) : null;

    if (!tf.enabled) {
      return h('div', {},
        h('div', { class: 'section-title', style: { margin: '0 0 4px' } }, 'Two-factor sign-in'),
        h('p', { class: 'dim settings-copy' }, 'After Plex, ask for a second step: a code from an app on your phone, or a passkey (Face ID, Touch ID, Windows Hello or a security key). If someone gets into your Plex account, they still can’t open this dashboard as you. Other browsers signed in to your account are signed out when you turn it on.'),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, appBtn, pkBtn),
        problem ? h('p', { class: 'dim', style: { fontSize: '12px', margin: '6px 0 0' } }, problem) : null, slot);
    }
    const off = h('button', { class: 'btn sm danger', onclick: async () => {
      const d = await guarded(() => api.sendJson('/api/account/2fa/disable', {}), tf.passkeys.length ? 'Confirm it’s you to remove the authenticator app (your passkeys stay).' : 'Confirm it’s you to turn two-factor off.');
      if (d) { update(d); toast(tf.passkeys.length ? 'Authenticator app removed' : 'Two-factor is off', 'warn'); }
    } }, tf.passkeys.length ? 'Remove the authenticator app' : 'Turn off');
    const fresh = h('button', { class: 'btn sm', onclick: async () => {
      const d = await guarded(() => api.sendJson('/api/account/2fa/recovery', {}), 'Confirm it’s you to make new recovery codes.');
      if (d) { update(d); showRecovery(d.recoveryCodes, card.querySelector('#tf-slot')); }
    } }, 'New recovery codes');
    return h('div', {},
      h('div', { class: 'section-title', style: { margin: '0 0 4px' } }, 'Two-factor sign-in'),
      h('p', { class: 'settings-copy', style: { margin: '0 0 8px' } }, h('span', { class: 'pill ok' }, 'On'), ` since ${when(tf.enabledAt)} · `,
        [tf.totp ? 'authenticator app' : null, tf.passkeys.length ? `${tf.passkeys.length} ${tf.passkeys.length === 1 ? 'passkey' : 'passkeys'}` : null].filter(Boolean).join(' and '),
        ` · ${tf.recoveryLeft} recovery ${tf.recoveryLeft === 1 ? 'code' : 'codes'} left`,
        tf.recoveryLeft <= 2 ? h('span', { class: 'pill warn', style: { marginLeft: '6px' } }, 'running low') : null),
      passkeyList,
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, tf.totp ? null : appBtn, pkBtn, fresh, tf.totp ? off : null),
      problem && !tf.passkeys.length ? h('p', { class: 'dim', style: { fontSize: '12px', margin: '6px 0 0' } }, problem) : null,
      slot);
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

  // New-device sign-in alerts: a switch, and the browsers this account knows.
  function alertsBlock() {
    const a = data.signInAlerts;
    if (!a) return null;
    const sw = h('input', { type: 'checkbox', role: 'switch', checked: a.enabled ? 'checked' : null, onchange: async () => {
      sw.disabled = true;
      try { update(await call('/alerts', { enabled: sw.checked })); toast(sw.checked ? 'Sign-in alerts are on' : 'Sign-in alerts are off', sw.checked ? 'success' : 'warn'); }
      catch (e) { sw.checked = !sw.checked; if (!e.cancelled) toast(e.message, 'error'); }
      sw.disabled = false;
    } });
    const others = a.devices.filter((d) => !d.current).length;
    const forget = others ? h('button', { class: 'btn sm', title: 'The next sign-in on any other browser sends an alert', onclick: async () => {
      if (forget.dataset.armed !== '1') { forget.dataset.armed = '1'; forget.textContent = `Forget ${others}?`; return; }
      try { const d = await call('/devices/forget'); update(d); toast(`Forgot ${d.forgotten} ${d.forgotten === 1 ? 'browser' : 'browsers'}`, 'success'); } catch (e) { toast(e.message, 'error'); }
    } }, 'Forget the other browsers') : null;
    const where = data.role === 'admin' ? 'your browsers and iOS app that have notifications on, and the notification channels' : 'your browsers and iOS app that have notifications on';
    return h('div', {},
      h('div', { class: 'section-title', style: { margin: '18px 0 4px' } }, 'Sign-in alerts'),
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px' } }, sw, 'Tell me when my account signs in on a browser it hasn’t used before'),
      h('p', { class: 'dim', style: { fontSize: '12px', margin: '4px 0 6px' } }, `Sent to ${where} (category “Sign-ins from a new device”).`),
      a.devices.length ? h('details', {}, h('summary', { class: 'dim', style: { cursor: 'pointer', fontSize: '13px' } }, `Known browsers (${a.devices.length})`),
        h('div', { class: 'list', style: { marginTop: '6px' } }, ...a.devices.map((d) => h('div', { class: 'row', style: { padding: '6px 12px' } }, h('div', { class: 'row-main' },
          h('div', { class: 'row-title', style: { fontSize: '13px' } }, d.name, ' ', d.current ? h('span', { class: 'pill info' }, 'this browser') : null),
          h('div', { class: 'meta-line', style: { fontSize: '12px' } }, h('span', {}, `first ${when(d.firstSeen)}`), h('span', {}, `last ${when(d.lastSeen)}`), d.ip ? h('span', { class: 'mono dim' }, d.ip) : null))))),
        forget ? h('div', { style: { marginTop: '6px' } }, forget) : null) : null);
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
      alertsBlock(),
      h('div', { class: 'section-title', style: { margin: '18px 0 4px', display: 'flex', alignItems: 'center', gap: '8px' } }, 'Where you’re signed in', h('span', { style: { flex: '1' } }),
        others ? h('button', { class: 'btn sm', onclick: async () => { try { const d = await call('/sessions/others'); update(d); toast(`Signed out ${d.removed} other ${d.removed === 1 ? 'session' : 'sessions'}`, 'success'); } catch (e) { toast(e.message, 'error'); } } }, 'Sign out everywhere else') : null),
      mine.length ? h('div', { class: 'list' }, ...mine.map((x) => sessionRow(x, false))) : h('p', { class: 'dim' }, 'No sessions.'),
      everyone.length ? h('details', { style: { marginTop: '16px' } }, h('summary', { style: { cursor: 'pointer', fontWeight: '600' } }, `Other people’s sessions (${everyone.length})`),
        h('div', { class: 'list', style: { marginTop: '8px' } }, ...everyone.map((x) => sessionRow(x, true)))) : null);
  }
  load();
  return card;
}
