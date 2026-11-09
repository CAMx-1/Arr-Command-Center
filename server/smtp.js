// A small SMTP client for the email notification channel, on Node's own
// net/tls (no dependency). Supports implicit TLS (port 465), STARTTLS (587),
// or plain (25, LAN relays only), AUTH PLAIN/LOGIN, and dot-stuffing.
// Certificates are always verified. Message headers are built from fixed
// templates; anything user-supplied that goes into a header has CR/LF removed,
// so a title can't add headers or recipients.
import net from 'node:net';
import tls from 'node:tls';
import { randomUUID } from 'node:crypto';
import os from 'node:os';

const clean = (v, n = 500) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, n);
export const isEmail = (v) => /^[^\s@<>()",;:\\]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(String(v || ''));

// RFC 2047 for non-ASCII header text.
export const encodeHeader = (v) => (/^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`);
// Body lines starting with "." get another "." (the end-of-data marker is ".").
export const dotStuff = (text) => String(text).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
const wrap76 = (b64) => b64.replace(/.{1,76}/g, '$&\r\n').replace(/\r\n$/, '');

export function buildMessage({ from, fromName = 'Arr Command Center', to, subject, text, html, date = new Date(), domain = 'arr-command-center.local' }) {
  const boundary = `acc-${randomUUID()}`;
  const headers = [
    `From: ${encodeHeader(clean(fromName, 80))} <${clean(from, 254)}>`,
    `To: ${to.map((x) => `<${clean(x, 254)}>`).join(', ')}`,
    `Subject: ${encodeHeader(clean(subject, 200))}`,
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomUUID()}@${clean(domain, 100)}>`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const part = (type, body) => [`--${boundary}`, `Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', wrap76(Buffer.from(body, 'utf8').toString('base64'))].join('\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${part('text/plain', text)}\r\n${part('text/html', html)}\r\n--${boundary}--\r\n`;
}

// One SMTP conversation. opts: { host, port, security: 'tls'|'starttls'|'none',
// username, password, from, to: [..], message, timeoutMs, tlsOptions }
export function sendMail(opts) {
  const { host, port, security = 'starttls', username = '', password = '', from, to, message, timeoutMs = 15000, tlsOptions = {} } = opts;
  return new Promise((resolve, reject) => {
    let sock = null; let buf = ''; let waiter = null; let done = false;
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); try { if (sock) { if (err) sock.destroy(); else sock.end(); } } catch { /* closed */ } err ? reject(err) : resolve(val); };
    const sni = net.isIP(host) ? {} : { servername: host };
    const timer = setTimeout(() => finish(new Error('Timed out')), timeoutMs);
    // Replies: "250-…" continues, "250 …" ends. Resolves with { code, text }.
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      while (waiter) {
        const lines = buf.split('\r\n');
        let end = -1;
        for (let i = 0; i < lines.length - 1; i++) if (/^\d{3}( |$)/.test(lines[i])) { end = i; break; }
        if (end < 0) return;
        const reply = lines.slice(0, end + 1);
        buf = lines.slice(end + 1).join('\r\n');
        const w = waiter; waiter = null;
        if (w) w({ code: Number(reply[end].slice(0, 3)), text: reply.map((l) => l.slice(4)).join('\n') });
      }
    };
    const read = () => new Promise((r) => { waiter = r; if (buf) onData(Buffer.alloc(0)); });
    const send = async (line, expect, what) => {
      if (line != null) sock.write(`${line}\r\n`);
      const r = await read();
      if (!expect.includes(r.code)) throw Object.assign(new Error(`${what}: ${r.code} ${r.text.split('\n')[0].slice(0, 160)}`), { code: r.code });
      return r;
    };
    const attach = (s) => { sock = s; s.on('data', onData); s.on('error', (e) => finish(new Error(e.code === 'ECONNREFUSED' ? 'Connection refused' : e.code === 'ENOTFOUND' ? 'Server not found' : /certificate|self.signed|altnames/i.test(e.message) ? `Certificate problem: ${e.message}` : e.message))); s.on('close', () => finish(new Error('The server closed the connection'))); };
    const ehloName = clean(os.hostname(), 100).replace(/[^\w.-]/g, '') || 'localhost';
    const run = async () => {
      await send(null, [220], 'Greeting');
      let ehlo = await send(`EHLO ${ehloName}`, [250], 'EHLO');
      if (security === 'starttls') {
        if (!/^STARTTLS$/im.test(ehlo.text)) throw new Error('The server doesn’t offer STARTTLS (try SSL/TLS on port 465)');
        await send('STARTTLS', [220], 'STARTTLS');
        const plain = sock; plain.removeListener('data', onData); plain.removeAllListeners('close'); plain.removeAllListeners('error');
        await new Promise((ok, bad) => { const t = tls.connect({ socket: plain, ...sni, ...tlsOptions }, ok); attach(t); t.once('error', bad); });
        ehlo = await send(`EHLO ${ehloName}`, [250], 'EHLO');
      }
      if (username) {
        const auth = (/^AUTH\s+(.*)$/im.exec(ehlo.text) || [])[1] || '';
        if (security === 'none' && !/^(localhost|127\.|::1)/.test(host)) throw new Error('Refusing to send the password over an unencrypted connection: use SSL/TLS or STARTTLS');
        if (/\bPLAIN\b/i.test(auth) || !auth) await send(`AUTH PLAIN ${Buffer.from(`\0${username}\0${password}`).toString('base64')}`, [235], 'Login');
        else if (/\bLOGIN\b/i.test(auth)) { await send('AUTH LOGIN', [334], 'Login'); await send(Buffer.from(username).toString('base64'), [334], 'Login'); await send(Buffer.from(password).toString('base64'), [235], 'Login'); }
        else throw new Error(`No supported login method (server offers ${auth})`);
      }
      await send(`MAIL FROM:<${clean(from, 254)}>`, [250], 'Sender');
      for (const r of to) await send(`RCPT TO:<${clean(r, 254)}>`, [250, 251], `Recipient ${r}`);
      await send('DATA', [354], 'DATA');
      await send(`${dotStuff(message)}\r\n.`, [250], 'Message');
      sock.write('QUIT\r\n');
      finish(null, { ok: true }); // the message is accepted; QUIT is a courtesy
    };
    const onConnect = () => run().catch((e) => finish(e));
    if (security === 'tls') attach(tls.connect({ host, port, ...sni, ...tlsOptions }, onConnect));
    else { const s = net.connect({ host, port }, onConnect); attach(s); }
  });
}
