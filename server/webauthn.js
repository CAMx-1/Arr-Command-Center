// Passkeys (WebAuthn) as a second sign-in step: registration and sign-in
// checks, with no library. Supports ES256 (P-256), EdDSA (Ed25519) and RS256
// keys, which covers iCloud Keychain, Google Password Manager, Windows Hello,
// 1Password and security keys. Attestation isn't requested ("none"): the key
// only has to prove it's the same device later, not who made it.
import crypto from 'node:crypto';
import net from 'node:net';

const b64u = (b) => Buffer.from(b).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s || ''), 'base64url');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();

// ------------------------------------------------------------ CBOR (decode)
export function cborDecode(buf, start = 0) {
  let pos = start;
  const need = (n) => { if (pos + n > buf.length) throw new Error('Truncated CBOR'); };
  const read = (depth = 0) => {
    if (depth > 16) throw new Error('CBOR too deep');
    need(1);
    const ib = buf[pos++]; const major = ib >> 5; const info = ib & 31;
    const arg = () => {
      if (info < 24) return info;
      if (info === 24) { need(1); return buf[pos++]; }
      if (info === 25) { need(2); const v = buf.readUInt16BE(pos); pos += 2; return v; }
      if (info === 26) { need(4); const v = buf.readUInt32BE(pos); pos += 4; return v; }
      if (info === 27) { need(8); const v = Number(buf.readBigUInt64BE(pos)); pos += 8; return v; }
      throw new Error('Unsupported CBOR length');
    };
    switch (major) {
      case 0: return arg();
      case 1: return -1 - arg();
      case 2: { const n = arg(); need(n); const v = Buffer.from(buf.subarray(pos, pos + n)); pos += n; return v; }
      case 3: { const n = arg(); need(n); const v = buf.toString('utf8', pos, pos + n); pos += n; return v; }
      case 4: { const n = arg(); if (n > 1000) throw new Error('CBOR array too long'); const a = []; for (let i = 0; i < n; i++) a.push(read(depth + 1)); return a; }
      case 5: { const n = arg(); if (n > 1000) throw new Error('CBOR map too long'); const m = new Map(); for (let i = 0; i < n; i++) { const k = read(depth + 1); m.set(k, read(depth + 1)); } return m; }
      case 6: arg(); return read(depth + 1);
      case 7:
        if (info === 20) return false; if (info === 21) return true; if (info === 22) return null; if (info === 23) return undefined;
        if (info === 26) { need(4); const v = buf.readFloatBE(pos); pos += 4; return v; }
        if (info === 27) { need(8); const v = buf.readDoubleBE(pos); pos += 8; return v; }
        throw new Error('Unsupported CBOR value');
      default: throw new Error('Unsupported CBOR');
    }
  };
  const value = read();
  return { value, end: pos };
}

// ------------------------------------------------------------ authenticator data
export const FLAGS = { UP: 0x01, UV: 0x04, BE: 0x08, BS: 0x10, AT: 0x40, ED: 0x80 };
export function parseAuthData(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 37) throw new Error('Authenticator data too short');
  const out = { rpIdHash: buf.subarray(0, 32), flags: buf[32], signCount: buf.readUInt32BE(33) };
  if (out.flags & FLAGS.AT) {
    if (buf.length < 55) throw new Error('No credential data');
    out.aaguid = buf.subarray(37, 53);
    const len = buf.readUInt16BE(53);
    if (len > 1023 || buf.length < 55 + len) throw new Error('Bad credential id');
    out.credentialId = Buffer.from(buf.subarray(55, 55 + len));
    const key = cborDecode(buf, 55 + len);
    out.cose = key.value;
  }
  return out;
}

// COSE key → { alg, jwk } (stored), and JWK → a key Node can verify with.
export function coseToJwk(cose) {
  if (!(cose instanceof Map)) throw new Error('Bad public key');
  const kty = cose.get(1); const alg = cose.get(3);
  if (kty === 2 && cose.get(-1) === 1 && alg === -7) return { alg: -7, jwk: { kty: 'EC', crv: 'P-256', x: b64u(cose.get(-2)), y: b64u(cose.get(-3)) } };
  if (kty === 1 && cose.get(-1) === 6 && alg === -8) return { alg: -8, jwk: { kty: 'OKP', crv: 'Ed25519', x: b64u(cose.get(-2)) } };
  if (kty === 3 && alg === -257) return { alg: -257, jwk: { kty: 'RSA', n: b64u(cose.get(-1)), e: b64u(cose.get(-2)) } };
  throw new Error('This kind of passkey isn’t supported (ES256, EdDSA or RS256 needed)');
}
export function verifySignature({ alg, jwk }, data, signature) {
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  if (alg === -7) return crypto.verify('sha256', data, key, signature); // DER-encoded ECDSA
  if (alg === -8) return crypto.verify(null, data, key, signature);
  if (alg === -257) return crypto.verify('sha256', data, { key, padding: crypto.constants.RSA_PKCS1_PADDING }, signature);
  return false;
}

// ------------------------------------------------------------ relying party
// Passkeys belong to a domain name: the one the dashboard is opened on. IP
// addresses can't have them; "localhost" can (for testing).
export function rpIdFor(host) {
  const h = String(host || '').trim().toLowerCase().replace(/^\[|\](:\d+)?$/g, '').replace(/:\d+$/, '');
  if (!h || net.isIP(h) || !/^[a-z0-9.-]+$/.test(h)) return null;
  return h;
}
// The page that asked: same host as the passkey's domain (or a subdomain),
// over https (http only for localhost).
export function originAllowed(origin, rpId) {
  let u; try { u = new URL(origin); } catch { return false; }
  const host = u.hostname.toLowerCase();
  if (host !== rpId && !host.endsWith(`.${rpId}`)) return false;
  return u.protocol === 'https:' || (u.protocol === 'http:' && (host === 'localhost' || host.endsWith('.localhost')));
}

export const newChallenge = () => b64u(crypto.randomBytes(32));
const PARAMS = [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -8 }, { type: 'public-key', alg: -257 }];

export function registrationOptions({ rpId, rpName = 'Arr Command Center', userHandle, userName, existing = [], challenge = newChallenge() }) {
  return {
    challenge, rp: { id: rpId, name: rpName }, user: { id: userHandle, name: userName, displayName: userName },
    pubKeyCredParams: PARAMS, timeout: 120000, attestation: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    excludeCredentials: existing.map((p) => ({ type: 'public-key', id: p.id, ...(p.transports && p.transports.length ? { transports: p.transports } : {}) })),
  };
}
export function authenticationOptions({ rpId, credentials = [], challenge = newChallenge() }) {
  return { challenge, rpId, timeout: 120000, userVerification: 'preferred', allowCredentials: credentials.map((p) => ({ type: 'public-key', id: p.id, ...(p.transports && p.transports.length ? { transports: p.transports } : {}) })) };
}

function checkClientData(raw, type, challenge, rpId) {
  let cd; try { cd = JSON.parse(fromB64u(raw).toString('utf8')); } catch { throw new Error('Bad client data'); }
  if (cd.type !== type) throw new Error('Wrong kind of response');
  const a = Buffer.from(String(cd.challenge || '')); const b = Buffer.from(String(challenge || ''));
  if (!challenge || a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('This passkey request has expired. Try again.');
  if (!originAllowed(cd.origin, rpId)) throw new Error('The passkey answered for another site');
  if (cd.crossOrigin === true) throw new Error('Passkeys can’t be used from an embedded page');
  return fromB64u(raw);
}

// response: { id, rawId, response: { clientDataJSON, attestationObject, transports } } (base64url)
export function verifyRegistration({ credential, challenge, rpId }) {
  const r = (credential && credential.response) || {};
  checkClientData(r.clientDataJSON, 'webauthn.create', challenge, rpId);
  const att = cborDecode(fromB64u(r.attestationObject)).value;
  if (!(att instanceof Map) || !Buffer.isBuffer(att.get('authData'))) throw new Error('Bad passkey response');
  const ad = parseAuthData(att.get('authData'));
  if (!ad.rpIdHash.equals(sha256(Buffer.from(rpId)))) throw new Error('The passkey was made for another site');
  if (!(ad.flags & FLAGS.UP)) throw new Error('The passkey didn’t confirm you were there');
  if (!(ad.flags & FLAGS.AT) || !ad.credentialId) throw new Error('No passkey in the response');
  if (credential.id && b64u(ad.credentialId) !== credential.id) throw new Error('Passkey id mismatch');
  const key = coseToJwk(ad.cose);
  const transports = (Array.isArray(r.transports) ? r.transports : []).filter((t) => /^[a-z-]{2,20}$/.test(t)).slice(0, 6);
  return { id: b64u(ad.credentialId), ...key, signCount: ad.signCount, transports, synced: !!(ad.flags & FLAGS.BE), userVerified: !!(ad.flags & FLAGS.UV) };
}

// response: { id, response: { clientDataJSON, authenticatorData, signature, userHandle } }
export function verifyAuthentication({ credential, challenge, rpId, stored }) {
  const r = (credential && credential.response) || {};
  if (!stored || credential.id !== stored.id) throw new Error('Unknown passkey');
  const clientData = checkClientData(r.clientDataJSON, 'webauthn.get', challenge, rpId);
  const authData = fromB64u(r.authenticatorData);
  const ad = parseAuthData(authData);
  if (!ad.rpIdHash.equals(sha256(Buffer.from(rpId)))) throw new Error('The passkey was made for another site');
  if (!(ad.flags & FLAGS.UP)) throw new Error('The passkey didn’t confirm you were there');
  const ok = verifySignature(stored, Buffer.concat([authData, sha256(clientData)]), fromB64u(r.signature));
  if (!ok) throw new Error('The passkey’s signature didn’t check out');
  // A counter that goes backwards means a copied authenticator (synced
  // passkeys always report 0, which is fine).
  if (ad.signCount !== 0 && stored.signCount !== 0 && ad.signCount <= stored.signCount) throw new Error('This passkey looks copied (its counter went backwards). Remove it and add it again.');
  return { signCount: ad.signCount, userVerified: !!(ad.flags & FLAGS.UV) };
}
