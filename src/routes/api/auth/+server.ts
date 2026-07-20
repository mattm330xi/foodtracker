import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const RP_NAME = 'Food Tracker';
const RP_ID = 'foodtracker.mattm330xi.workers.dev';
const ORIGIN = `https://${RP_ID}`;

function generateChallenge(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bufToBase64url(bytes.buffer);
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bufToBase64url(bytes.buffer);
}

function bufToBase64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBuf(str: string): ArrayBuffer {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function setSessionCookie(token: string, userId: number): string {
  const maxAge = 60 * 60 * 24 * 30;
  return `ft_session=${userId}:${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

// ─── Minimal CBOR parser ────────────────────────────────────

class CborReader {
  private view: DataView;
  private offset = 0;
  constructor(private buf: ArrayBuffer) { this.view = new DataView(buf); }

  readInfo(): [number, number] {
    const byte = this.view.getUint8(this.offset++);
    return [byte >> 5, byte & 0x1f];
  }

  readAdditional(info: number): number {
    if (info === 24) return this.view.getUint8(this.offset++);
    if (info === 25) { const v = this.view.getUint16(this.offset, false); this.offset += 2; return v; }
    if (info === 26) { const v = this.view.getUint32(this.offset, false); this.offset += 4; return v; }
    return 0;
  }

  readAny(): any {
    const [major, info] = this.readInfo();
    if (major === 0) return info < 24 ? info : this.readAdditional(info);
    if (major === 1) return -(this.readAdditional(info)) - 1;
    if (major === 2) { const len = info < 24 ? info : this.readAdditional(info); const b = this.buf.slice(this.offset, this.offset + len); this.offset += len; return b; }
    if (major === 3) { const len = info < 24 ? info : this.readAdditional(info); const s = new TextDecoder().decode(this.buf.slice(this.offset, this.offset + len)); this.offset += len; return s; }
    if (major === 4) { const len = info < 24 ? info : this.readAdditional(info); const arr = []; for (let i = 0; i < len; i++) arr.push(this.readAny()); return arr; }
    if (major === 5) {
      const len = info < 24 ? info : this.readAdditional(info);
      const map: any = {};
      for (let i = 0; i < len; i++) { const key = this.readAny(); const val = this.readAny(); map[key] = val; }
      return map;
    }
    this.offset++;
    return null;
  }
}

function parseCbor(buf: ArrayBuffer): any {
  return new CborReader(buf).readAny();
}

// ─── Parse attestation ─────────────────────────────────────

function parseAttestationObject(attObjBuf: ArrayBuffer) {
  const obj = parseCbor(attObjBuf);
  const authData = new Uint8Array(obj.authData);

  const view = new DataView(authData.buffer, authData.byteOffset, authData.byteLength);
  const flags = view.getUint8(32);
  const signCount = view.getUint32(33, false);

  if (!(flags & 0x40)) {
    console.error('AT flag not set in authData');
    return null;
  }

  let offset = 53;
  const credIdLen = view.getUint16(offset, false); offset += 2;
  const credentialId = authData.slice(offset, offset + credIdLen);
  offset += credIdLen;
  const publicKey = authData.slice(offset).buffer;

  return { credentialId: bufToBase64url(credentialId.buffer), publicKey, signCount };
}

// ─── Parse COSE public key ─────────────────────────────────

function parseCoseKey(coseKeyBuf: ArrayBuffer) {
  const map = parseCbor(coseKeyBuf);
  return {
    kty: map[1],
    alg: map[3],
    crv: map[-1],
    x: new Uint8Array(map[-2]),
    y: new Uint8Array(map[-3]),
  };
}

async function importCoseKey(coseKeyBuf: ArrayBuffer): Promise<CryptoKey> {
  const { kty, crv, x, y } = parseCoseKey(coseKeyBuf);

  if (kty === 2 && crv === 1) {
    const rawPub = new Uint8Array(1 + 32 + 32);
    rawPub[0] = 0x04;
    rawPub.set(x, 1);
    rawPub.set(y, 33);
    return crypto.subtle.importKey('raw', rawPub.buffer, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  }

  if (kty === 3) {
    const spki = buildRSASPKI(x, y);
    return crypto.subtle.importKey('spki', spki, { name: 'RSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  }

  throw new Error(`Unsupported key: kty=${kty}`);
}

function buildRSASPKI(n: Uint8Array, e: Uint8Array): ArrayBuffer {
  return buildDer([0x30], buildDer(
    buildDer([0x30], concat([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b], [0x05, 0x00])),
    buildDer([0x03], concat([0x00], buildDer([0x30], concat([0x02], derInt(n), [0x02], derInt(e)))))
  )).buffer;
}

function derInt(bytes: Uint8Array): Uint8Array {
  if (bytes[0] & 0x80) return concat([0x02, bytes.length + 1, 0x00], bytes);
  return concat([0x02], derLen(bytes.length), bytes);
}

function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const r = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { r.set(p instanceof Uint8Array ? p : new Uint8Array(p), o); o += p.length; }
  return r;
}

function derLen(len: number): Uint8Array {
  if (len < 0x80) return new Uint8Array([len]);
  if (len < 0x100) return new Uint8Array([0x18, len]);
  return new Uint8Array([0x19, (len >> 8) & 0xff, len & 0xff]);
}

function buildDer(...parts: (Uint8Array | number[])[]): Uint8Array {
  const content = concat(...parts);
  return concat(derLen(content.length + 0x30 - 0x30).length > 1 ? [0x30] : [0x30], derLen(content.length), content);
}

// ─── Verify registration ───────────────────────────────────

async function verifyRegistrationResponse(credential: any, expectedChallenge: string) {
  try {
    const clientDataJSON = base64urlToBuf(credential.response.clientDataJSON);
    const attestationObject = base64urlToBuf(credential.response.attestationObject);

    const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));
    console.log('verifyReg challenge match:', clientData.challenge === expectedChallenge);
    console.log('verifyReg origin match:', clientData.origin === ORIGIN);
    console.log('verifyReg type:', clientData.type);

    if (clientData.type !== 'webauthn.create') { console.error('Bad type'); return null; }
    if (clientData.challenge !== expectedChallenge) { console.error('Challenge mismatch:', clientData.challenge, 'vs', expectedChallenge); return null; }
    if (clientData.origin !== ORIGIN) { console.error('Origin mismatch'); return null; }

    const parsed = parseAttestationObject(attestationObject);
    if (!parsed) { console.error('Failed to parse attestation'); return null; }

    return { credentialId: parsed.credentialId, publicKey: parsed.publicKey, counter: parsed.signCount };
  } catch (e) {
    console.error('verifyRegistration error:', e);
    return null;
  }
}

// ─── Verify assertion ──────────────────────────────────────

async function verifyAssertionResponse(credential: any, expectedChallenge: string, storedPubKey: ArrayBuffer, storedCounter: number) {
  try {
    const clientDataJSON = base64urlToBuf(credential.response.clientDataJSON);
    const authenticatorData = base64urlToBuf(credential.response.authenticatorData);
    const signature = base64urlToBuf(credential.response.signature);

    const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));
    console.log('verifyAssert type:', clientData.type);
    console.log('verifyAssert challenge match:', clientData.challenge === expectedChallenge);
    console.log('verifyAssert origin match:', clientData.origin === ORIGIN);

    if (clientData.type !== 'webauthn.get') return null;
    if (clientData.challenge !== expectedChallenge) { console.error('Challenge mismatch'); return null; }
    if (clientData.origin !== ORIGIN) { console.error('Origin mismatch'); return null; }

    const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataJSON);
    const signedData = new Uint8Array(authenticatorData.byteLength + 32);
    signedData.set(new Uint8Array(authenticatorData), 0);
    signedData.set(new Uint8Array(clientDataHash), authenticatorData.byteLength);

    const key = await importCoseKey(storedPubKey);
    const { kty } = parseCoseKey(storedPubKey);

    let valid: boolean;
    if (kty === 2) {
      valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, signedData.buffer);
    } else {
      valid = await crypto.subtle.verify('RSA-PKCS1-v1_5', key, signature, signedData.buffer);
    }

    if (!valid) { console.error('Signature invalid'); return null; }

    const newCounter = new DataView(authenticatorData.buffer, authenticatorData.byteOffset).getUint32(authenticatorData.byteLength - 4, false);
    if (storedCounter !== 0 && newCounter <= storedCounter) { console.error('Counter replay'); return null; }

    return { newCounter };
  } catch (e) {
    console.error('verifyAssertion error:', e);
    return null;
  }
}

// ─── Handlers ──────────────────────────────────────────────

export const GET: RequestHandler = async ({ cookies, platform }) => {
  const session = cookies.get('ft_session');
  if (!session) return json({ user: null });
  const [userId, token] = session.split(':');
  if (!userId || !token) return json({ user: null });
  const db = platform!.env.FTD1;
  const row = await db.prepare(
    "SELECT u.id, u.username, u.timezone FROM users u JOIN sessions s ON u.id = s.user_id WHERE s.user_id = ? AND s.token = ? AND s.expires_at > datetime('now') LIMIT 1"
  ).bind(parseInt(userId), token).first();
  return json({ user: row || null });
};

export const POST: RequestHandler = async ({ request, cookies, platform }) => {
  const { action, ...body } = await request.json();
  const db = platform!.env.FTD1;

  // ── REGISTER START ──────────────────────────────────────
  if (action === 'register-start') {
    const { username } = body;
    if (!username) return json({ error: 'Username required' }, { status: 400 });
    const clean = username.trim().toLowerCase();

    const existing = await db.prepare('SELECT id FROM users WHERE username = ?').bind(clean).first();
    if (existing) return json({ error: 'Username already taken' }, { status: 409 });

    const result = await db.prepare('INSERT INTO users (username) VALUES (?)').bind(clean).run();
    const userId = result.meta.last_row_id as number;
    const challenge = generateChallenge();

    const sessionToken = `reg:${challenge}:${userId}`;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
    await db.prepare('INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)')
      .bind(userId, sessionToken, expiresAt).run();

    return json({
      options: {
        rp: { name: RP_NAME, id: RP_ID },
        user: {
          id: bufToBase64url(new TextEncoder().encode(String(userId)).buffer),
          name: clean, displayName: clean,
        },
        challenge,
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60000,
        attestation: 'none',
      }
    }, {
      headers: { 'Set-Cookie': setSessionCookie(sessionToken, userId) }
    });
  }

  // ── REGISTER FINISH ─────────────────────────────────────
  if (action === 'register-finish') {
    const cookie = cookies.get('ft_session');
    if (!cookie?.startsWith('reg:')) return json({ error: 'No registration session' }, { status: 401 });

    const [, challenge, userIdStr] = cookie.split(':');
    const userId = parseInt(userIdStr);
    const { credential } = body;

    const verified = await verifyRegistrationResponse(credential, challenge);
    if (!verified) return json({ error: 'Verification failed' }, { status: 400 });

    const transports = credential.response?.getTransports?.() || [];
    await db.prepare(
      'INSERT INTO credentials (user_id, credential_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?)'
    ).bind(userId, credential.id, new Uint8Array(verified.publicKey), verified.counter, transports.join(',')).run();

    await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
    const realToken = generateToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await db.prepare('INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)')
      .bind(userId, realToken, expiresAt).run();

    const profile = await db.prepare('SELECT id, username, timezone FROM users WHERE id = ?').bind(userId).first();
    return json({ success: true, user: profile }, {
      headers: { 'Set-Cookie': setSessionCookie(realToken, userId) }
    });
  }

  // ── LOGIN START ─────────────────────────────────────────
  if (action === 'login-start') {
    const { username } = body;
    if (!username) return json({ error: 'Username required' }, { status: 400 });
    const clean = username.trim().toLowerCase();

    const user = await db.prepare('SELECT id FROM users WHERE username = ?').bind(clean).first() as any;
    if (!user) return json({ error: 'No account found with that username' }, { status: 404 });

    const creds = await db.prepare('SELECT credential_id, transports FROM credentials WHERE user_id = ?').bind(user.id).all();

    if (creds.results.length === 0) {
      return json({ error: 'No passkeys registered for this account. Register first.' }, { status: 400 });
    }

    const challenge = generateChallenge();
    const sessionToken = `auth:${challenge}:${user.id}`;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await db.prepare('DELETE FROM sessions WHERE user_id = ? AND token LIKE ?').bind(user.id, 'auth:%').run();
    await db.prepare('INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)')
      .bind(user.id, sessionToken, expiresAt).run();

    return json({
      options: {
        challenge,
        rpId: RP_ID,
        allowCredentials: creds.results.map((c: any) => ({
          id: c.credential_id,
          type: 'public-key',
          transports: c.transports ? c.transports.split(',') : ['internal'],
        })),
        userVerification: 'required',
        timeout: 60000,
      },
      userId: user.id,
      _debug: { challenge },
    });
  }

  // ── LOGIN FINISH ────────────────────────────────────────
  if (action === 'login-finish') {
    const { credential, userId, challenge } = body;

    const cred = await db.prepare(
      'SELECT * FROM credentials WHERE credential_id = ? AND user_id = ?'
    ).bind(credential.id, userId).first() as any;

    if (!cred) return json({ error: 'Credential not found' }, { status: 404 });

    const verified = await verifyAssertionResponse(credential, challenge, cred.public_key, cred.counter);
    if (!verified) return json({ error: 'Signature verification failed' }, { status: 400 });

    await db.prepare('UPDATE credentials SET counter = ? WHERE id = ?').bind(verified.newCounter, cred.id).run();

    await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
    const realToken = generateToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await db.prepare('INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)')
      .bind(userId, realToken, expiresAt).run();

    const profile = await db.prepare('SELECT id, username, timezone FROM users WHERE id = ?').bind(userId).first();
    return json({ success: true, user: profile }, {
      headers: { 'Set-Cookie': setSessionCookie(realToken, userId) }
    });
  }

  // ── LOGOUT ──────────────────────────────────────────────
  if (action === 'logout') {
    const session = cookies.get('ft_session');
    if (session) {
      const userIdStr = session.split(':')[0];
      if (userIdStr && !userIdStr.startsWith('reg:') && !userIdStr.startsWith('auth:')) {
        await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(parseInt(userIdStr)).run();
      }
    }
    return json({ success: true }, {
      headers: { 'Set-Cookie': 'ft_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' }
    });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
};
