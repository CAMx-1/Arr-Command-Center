// Passkeys in the browser (WebAuthn), and the "Confirm it's you" dialog used
// before sensitive changes. The server sends options with base64url strings;
// the browser API wants ArrayBuffers, and the answer goes back as base64url.
import { h, mount, toast, openModal, closeModal } from './ui.js';
import { api } from './api.js';

const toBuf = (s) => { const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; };
const toB64u = (buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

// Passkeys need a secure page opened by name (not an IP address).
export function passkeyProblem(loc = globalThis.location) {
  if (typeof window === 'undefined' || !window.PublicKeyCredential || !navigator.credentials) return 'This browser doesn’t support passkeys.';
  if (!window.isSecureContext) return 'Passkeys need the dashboard to be opened over https (or on localhost).';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(loc.hostname) || loc.hostname.includes(':')) return 'Passkeys need the dashboard to be opened by name (its domain), not by IP address.';
  return null;
}

const friendly = (e) => (e && e.name === 'NotAllowedError' ? 'Cancelled, or the passkey wasn’t available.' : e && e.name === 'InvalidStateError' ? 'This device already has a passkey for this account.' : e && e.name === 'SecurityError' ? 'This address can’t use passkeys (open the dashboard by its domain name).' : (e && e.message) || 'The passkey didn’t work.');

export async function createPasskey(o) {
  try {
    const cred = await navigator.credentials.create({ publicKey: {
      ...o, challenge: toBuf(o.challenge), user: { ...o.user, id: toBuf(o.user.id) },
      excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: toBuf(c.id) })),
    } });
    const r = cred.response;
    return { id: cred.id, rawId: toB64u(cred.rawId), type: cred.type, response: { clientDataJSON: toB64u(r.clientDataJSON), attestationObject: toB64u(r.attestationObject), transports: typeof r.getTransports === 'function' ? r.getTransports() : [] } };
  } catch (e) { throw new Error(friendly(e)); }
}

export async function usePasskey(o) {
  try {
    const cred = await navigator.credentials.get({ publicKey: { ...o, challenge: toBuf(o.challenge), allowCredentials: (o.allowCredentials || []).map((c) => ({ ...c, id: toBuf(c.id) })) } });
    const r = cred.response;
    return { id: cred.id, rawId: toB64u(cred.rawId), type: cred.type, response: { clientDataJSON: toB64u(r.clientDataJSON), authenticatorData: toB64u(r.authenticatorData), signature: toB64u(r.signature), userHandle: r.userHandle ? toB64u(r.userHandle) : null } };
  } catch (e) { throw new Error(friendly(e)); }
}

// "Confirm it's you": a code from the authenticator app, a recovery code, or
// a passkey. Resolves true when the server accepted it (good for 10 minutes),
// false if cancelled.
export function confirmIdentity({ reason = 'Confirm it’s you to continue.' } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; closeModal(); resolve(v); };
    const msg = h('div', { style: { fontSize: '13px', minHeight: '18px' } });
    const body = h('div', {}, h('p', { style: { margin: '0 0 10px' } }, reason), h('div', { class: 'dim' }, 'Checking…'));
    openModal({ title: 'Confirm it’s you', body, footer: h('div', { style: { display: 'flex', justifyContent: 'flex-end', width: '100%' } }, h('button', { class: 'btn', onclick: () => done(false) }, 'Cancel')) });
    // Closing the dialog any other way counts as cancel.
    const watch = setInterval(() => { if (!body.isConnected) { clearInterval(watch); if (!settled) { settled = true; resolve(false); } } }, 300);
    api.sendJson('/api/account/verify/options', {}).then((opts) => {
      const parts = [h('p', { style: { margin: '0 0 10px' } }, reason)];
      const send = async (payload, btn) => {
        if (btn) btn.disabled = true;
        try { await api.sendJson('/api/account/verify', payload); clearInterval(watch); done(true); }
        catch (e) { mount(msg, h('span', { style: { color: 'var(--red)' } }, e.message)); if (btn) btn.disabled = false; }
      };
      if (opts.methods.passkey && !passkeyProblem()) {
        const b = h('button', { class: 'btn primary', onclick: async () => { b.disabled = true; try { send({ passkey: await usePasskey(opts.passkey) }, b); } catch (e) { mount(msg, h('span', { style: { color: 'var(--red)' } }, e.message)); b.disabled = false; } } }, 'Use a passkey');
        parts.push(h('div', { style: { margin: '0 0 10px' } }, b));
      }
      if (opts.methods.code || opts.methods.recovery) {
        const input = h('input', { class: 'input', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: opts.methods.code ? 'Code from your authenticator app, or a recovery code' : 'A recovery code', style: { flex: '1', minWidth: '200px' } });
        const go = h('button', { class: 'btn sm', onclick: () => input.value.trim() && send({ code: input.value.trim() }, go) }, 'Confirm');
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
        parts.push(h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, input, go));
        setTimeout(() => input.focus(), 0);
      }
      if (parts.length === 1) parts.push(h('p', { class: 'dim' }, 'No way to confirm from here.'));
      mount(body, ...parts, msg);
    }).catch((e) => { mount(body, h('p', {}, e.message)); });
  });
}

// For a call that may answer { needsVerification: true }: confirm, then retry once.
export async function withVerification(run, reason) {
  try { return await run(); }
  catch (e) {
    if (!(e && (e.needsVerification || (e.data && e.data.needsVerification)))) throw e;
    if (!(await confirmIdentity({ reason }))) throw Object.assign(new Error('Cancelled'), { cancelled: true });
    return run();
  }
}

export const passkeyToast = (e) => toast(e.message, 'error', 6000);
