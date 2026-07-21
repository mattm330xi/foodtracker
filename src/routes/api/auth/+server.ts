import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const RP_NAME = 'Food Tracker';

function getRpId(origin: string): string {
  return new URL(origin).hostname;
}

function getOrigin(request: Request): string {
  return new URL(request.url).origin;
}

// ─── Utilities ─────────────────────────────────────────────

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

function toAB(input: any): ArrayBuffer {
  if (input instanceof ArrayBuffer) return input;
  if (ArrayBuffer.isView(input)) {
    const v = input as ArrayBufferView;
    return (v.buffer as ArrayBuffer).slice(v.byteOffset, v.byteOffset + v.byteLength);
  }
  if (input?.buffer) {
    const b = input.buffer;
    if (b instanceof ArrayBuffer || b?.constructor?.name === 'ArrayBuffer') {
      return b.slice(input.byteOffset ?? 0, (input.byteOffset ?? 0) + (input.byteLength ?? b.byteLength));
    }
  }
  if (typeof input === 'string') {
    const hexMatch = /^[0-9a-fA-F]*$/.test(input) && input.length % 2 === 0;
    if (hexMatch) {
      const bytes = new Uint8Array(input.length / 2);
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(input.substr(i * 2, 2), 16);
      return bytes.buffer;
    }
    const padded = input.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    const binary = atob(padded + pad);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
  if (Array.isArray(input)) return new Uint8Array(input).buffer;
  throw new Error(`Cannot convert ${typeof input} (${input?.constructor?.name}) to ArrayBuffer`);
}

function setSessionCookie(token: string, userId: number): string {
  const maxAge = 60 * 60 * 24 * 60;
  return `ft_session=${userId}:${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

// ─── Minimal CBOR parser ───────────────────────────────────

class CborReader {
  private view: DataView;
  private buf: ArrayBuffer;
  private offset = 0;

  constructor(input: ArrayBuffer | Uint8Array) {
    this.buf = toAB(input);
    this.view = new DataView(this.buf);
  }

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
    if (major === 1) { const v = info < 24 ? info : this.readAdditional(info); return -(v) - 1; }
    if (major === 2) {
      const len = info < 24 ? info : this.readAdditional(info);
      const b = this.buf.slice(this.offset, this.offset + len);
      this.offset += len;
      return b;
    }
    if (major === 3) {
      const len = info < 24 ? info : this.readAdditional(info);
      const s = new TextDecoder().decode(this.buf.slice(this.offset, this.offset + len));
      this.offset += len;
      return s;
    }
    if (major === 4) {
      const len = info < 24 ? info : this.readAdditional(info);
      const arr = [];
      for (let i = 0; i < len; i++) arr.push(this.readAny());
      return arr;
    }
    if (major === 5) {
      const len = info < 24 ? info : this.readAdditional(info);
      const map: any = {};
      for (let i = 0; i < len; i++) {
        const key = this.readAny();
        const val = this.readAny();
        map[key] = val;
      }
      return map;
    }
    this.offset++;
    return null;
  }
}

function parseCbor(buf: ArrayBuffer | Uint8Array): any {
  return new CborReader(buf).readAny();
}

// ─── Parse attestation object ──────────────────────────────

function parseAttestationObject(attObjBuf: ArrayBuffer) {
  const obj = parseCbor(attObjBuf);
  const authData = new Uint8Array(toAB(obj.authData));

  const view = new DataView(authData.buffer, authData.byteOffset, authData.byteLength);
  const flags = view.getUint8(32);
  const signCount = view.getUint32(33, false);

  if (!(flags & 0x40)) {
    console.error('AT flag not set in authData');
    return null;
  }

  let offset = 53;
  const credIdLen = view.getUint16(offset, false);
  offset += 2;

  const credentialId = authData.slice(offset, offset + credIdLen);
  offset += credIdLen;

  const cosePublicKey = authData.slice(offset);

  return {
    credentialId: bufToBase64url(toAB(credentialId)),
    cosePublicKey: bufToBase64url(toAB(cosePublicKey)),
    signCount,
  };
}

// ─── Verify registration ───────────────────────────────────

async function verifyRegistrationResponse(credential: any, expectedChallenge: string, expectedOrigin: string) {
  try {
    const clientDataJSON = base64urlToBuf(credential.response.clientDataJSON);
    const attestationObject = base64urlToBuf(credential.response.attestationObject);
    const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));

    if (clientData.type !== 'webauthn.create') return null;
    if (clientData.challenge !== expectedChallenge) return null;
    if (clientData.origin !== expectedOrigin) return null;

    const parsed = parseAttestationObject(attestationObject);
    if (!parsed) return null;

    return {
      credentialId: parsed.credentialId,
      publicKey: parsed.cosePublicKey,
      counter: parsed.signCount ?? 0,
    };
  } catch (e) {
    console.error('verifyRegistration error:', e);
    return null;
  }
}

// ─── COSE public key → CryptoKey ──────────────────────────

async function importCoseKey(coseKeyBuf: ArrayBuffer | Uint8Array): Promise<CryptoKey> {
  const map = parseCbor(coseKeyBuf);
  const kty = map[1];
  const crv = map[-1];
  const x = new Uint8Array(toAB(map[-2]));
  const y = new Uint8Array(toAB(map[-3]));

  if (kty === 2 && crv === 1) {
    const rawPub = new Uint8Array(1 + 32 + 32);
    rawPub[0] = 0x04;
    rawPub.set(x, 1);
    rawPub.set(y, 33);
    return crypto.subtle.importKey('raw', rawPub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  }

  throw new Error(`Unsupported COSE key: kty=${kty} crv=${crv}`);
}

// ─── DER → IEEE P1363 signature conversion ─────────────────

function derToP1363(der: Uint8Array, keySize: number): Uint8Array | null {
  if (der.length < 2 || der[0] !== 0x30) return null;

  let offset = 2;
  if (der[1] & 0x80) offset += der[1] & 0x7f;

  const readInt = (): Uint8Array | null => {
    if (offset >= der.length || der[offset] !== 0x02) return null;
    offset++;
    let len = der[offset++];
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let i = 0; i < n; i++) len = (len << 8) | der[offset++];
    }
    const start = offset;
    offset += len;
    const raw = der.slice(start, start + len);
    if (raw.length > keySize && raw[0] === 0x00) {
      return raw.slice(raw.length - keySize);
    }
    if (raw.length < keySize) {
      const padded = new Uint8Array(keySize);
      padded.set(raw, keySize - raw.length);
      return padded;
    }
    return raw.length === keySize ? raw : null;
  };

  const r = readInt();
  const s = readInt();
  if (!r || !s || r.length !== keySize || s.length !== keySize) return null;

  const result = new Uint8Array(keySize * 2);
  result.set(r, 0);
  result.set(s, keySize);
  return result;
}

// ─── Verify assertion ──────────────────────────────────────

async function verifyAssertionResponse(
  credential: any,
  expectedChallenge: string,
  storedCoseKeyBase64: string,
  storedCounter: number,
  expectedOrigin: string,
) {
  try {
    const clientDataJSON = base64urlToBuf(credential.response.clientDataJSON);
    const authenticatorData = base64urlToBuf(credential.response.authenticatorData);
    const signature = new Uint8Array(base64urlToBuf(credential.response.signature));

    const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));

    if (clientData.type !== 'webauthn.get') return { error: 'bad type' };
    if (clientData.challenge !== expectedChallenge) return { error: 'challenge mismatch' };
    if (clientData.origin !== expectedOrigin) return { error: 'origin mismatch' };

    const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataJSON);
    const authBuf = toAB(authenticatorData);
    const signedData = new Uint8Array(authBuf.byteLength + 32);
    signedData.set(new Uint8Array(authBuf), 0);
    signedData.set(new Uint8Array(clientDataHash), authBuf.byteLength);

    const coseKeyBuf = base64urlToBuf(storedCoseKeyBase64);
    const key = await importCoseKey(coseKeyBuf);

    let valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      signature as BufferSource,
      signedData as BufferSource,
    );

    if (!valid) {
      const p1363 = derToP1363(signature, 32);
      if (p1363) {
        valid = await crypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' },
          key,
          p1363 as BufferSource,
          signedData as BufferSource,
        );
      }
    }

    if (!valid) return { error: 'signature invalid' };

    const authDataView = new DataView(authBuf);
    const newCounter = authDataView.getUint32(33, false);
    if (storedCounter !== 0 && newCounter <= storedCounter) return { error: 'counter replay' };

    return { newCounter };
  } catch (e: any) {
    console.error('verifyAssertion error:', e?.message);
    return { error: e?.message || String(e) };
  }
}

// ─── Route handlers ────────────────────────────────────────

export const GET: RequestHandler = async ({ cookies, platform }) => {
  const session = cookies.get('ft_session');
  if (!session) return json({ user: null });
  const [userId, token] = session.split(':');
  if (!userId || !token) return json({ user: null });
  const db = platform!.env.FTD1;
  const row = await db.prepare(
    "SELECT u.id, u.username, u.timezone FROM users u JOIN sessions s ON u.id = s.user_id WHERE s.user_id = ? AND s.token = ? AND s.expires_at > datetime('now') LIMIT 1",
  )
    .bind(parseInt(userId) || null, token ?? null)
    .first();
  return json({ user: row || null });
};

export const POST: RequestHandler = async ({ request, cookies, platform }) => {
  try {
    const { action, ...body } = await request.json();
    const db = platform!.env.FTD1;
    const rpId = getRpId(getOrigin(request));
    const origin = `https://${rpId}`;

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
      await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId ?? null).run();
      await db.prepare('INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)')
        .bind(userId ?? null, sessionToken ?? null, expiresAt ?? null)
        .run();

      return json(
        {
          options: {
            rp: { name: RP_NAME, id: rpId },
            user: {
              id: bufToBase64url(new TextEncoder().encode(String(userId)).buffer),
              name: clean,
              displayName: clean,
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
          },
        },
        { headers: { 'Set-Cookie': setSessionCookie(sessionToken, userId) } },
      );
    }

    // ── REGISTER FINISH ─────────────────────────────────────
    if (action === 'register-finish') {
      const cookie = cookies.get('ft_session');
      const parts = cookie?.split(':');
      if (!parts || parts.length < 4 || parts[1] !== 'reg') return json({ error: 'No registration session' }, { status: 401 });

      const userId = parseInt(parts[0] ?? '0');
      const challenge = parts[2];
      const { credential } = body;

      if (!credential) return json({ error: 'Missing credential' }, { status: 400 });

      const verified = await verifyRegistrationResponse(credential, challenge ?? '', origin);
      if (!verified) return json({ error: 'Verification failed' }, { status: 400 });

      const transports = credential.response?.transports ?? [];
      const pkBuf = new Uint8Array(base64urlToBuf(verified.publicKey));

      await db
        .prepare(
          'INSERT INTO credentials (user_id, credential_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(
          userId ?? null,
          (credential.id ?? null) as string,
          pkBuf,
          verified.counter ?? 0,
          (Array.isArray(transports) ? transports.join(',') : '') as string,
        )
        .run();

      await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId ?? null).run();
      const realToken = generateToken();
      const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
      await db.prepare('INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)')
        .bind(userId ?? null, realToken ?? null, expiresAt ?? null)
        .run();

      const profile = await db
        .prepare('SELECT id, username, timezone FROM users WHERE id = ?')
        .bind(userId ?? null)
        .first();
      return json({ success: true, user: profile }, {
        headers: { 'Set-Cookie': setSessionCookie(realToken, userId) },
      });
    }

    // ── LOGIN START ─────────────────────────────────────────
    if (action === 'login-start') {
      const { username } = body;
      if (!username) return json({ error: 'Username required' }, { status: 400 });
      const clean = username.trim().toLowerCase();

      const user = (await db
        .prepare('SELECT id FROM users WHERE username = ?')
        .bind(clean)
        .first()) as any;
      if (!user) return json({ error: 'No account found with that username' }, { status: 404 });

      const creds = await db
        .prepare('SELECT credential_id, transports FROM credentials WHERE user_id = ?')
        .bind(user.id ?? null)
        .all();

      if (creds.results.length === 0) {
        return json(
          { error: 'No passkeys registered for this account. Register first.' },
          { status: 400 },
        );
      }

      const challenge = generateChallenge();
      const sessionToken = `auth:${challenge}:${user.id}`;
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      await db
        .prepare('DELETE FROM sessions WHERE user_id = ? AND token LIKE ?')
        .bind(user.id ?? null, 'auth:%')
        .run();
      await db.prepare('INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)')
        .bind(user.id ?? null, sessionToken ?? null, expiresAt ?? null)
        .run();

      return json(
        {
          options: {
            challenge,
            rpId: rpId,
            allowCredentials: creds.results.map((c: any) => ({
              id: c.credential_id,
              type: 'public-key',
              transports: c.transports ? c.transports.split(',') : ['internal'],
            })),
            userVerification: 'required',
            timeout: 60000,
          },
          userId: user.id,
        },
        { headers: { 'Set-Cookie': setSessionCookie(sessionToken, user.id) } },
      );
    }

    // ── LOGIN FINISH ────────────────────────────────────────
    if (action === 'login-finish') {
      const cookie = cookies.get('ft_session');
      const parts = cookie?.split(':');
      if (!parts || parts.length < 4 || parts[1] !== 'auth') return json({ error: 'No auth session' }, { status: 401 });

      const userId = parseInt(parts[0] ?? '0');
      const challenge = parts[2];
      const { credential } = body;

      if (!credential) return json({ error: 'Missing credential' }, { status: 400 });

      const cred = (await db
        .prepare('SELECT * FROM credentials WHERE credential_id = ? AND user_id = ?')
        .bind(credential.id ?? null, userId ?? null)
        .first()) as any;

      if (!cred) return json({ error: 'Credential not found' }, { status: 404 });

      let storedKeyBase64: string;
      if (typeof cred.public_key === 'string') {
        storedKeyBase64 = cred.public_key;
      } else if (cred.public_key) {
        storedKeyBase64 = bufToBase64url(toAB(cred.public_key));
      } else {
        return json({ error: 'Stored key has unexpected type' }, { status: 500 });
      }

      const verified = await verifyAssertionResponse(
        credential,
        challenge ?? '',
        storedKeyBase64,
        cred.counter ?? 0,
        origin,
      );
      if (verified.error) {
        return json({ error: 'Signature verification failed', detail: verified.error }, { status: 400 });
      }

      await db
        .prepare('UPDATE credentials SET counter = ? WHERE id = ?')
        .bind(verified.newCounter ?? 0, cred.id ?? null)
        .run();

      await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId ?? null).run();
      const realToken = generateToken();
      const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
      await db.prepare('INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)')
        .bind(userId ?? null, realToken ?? null, expiresAt ?? null)
        .run();

      const profile = await db
        .prepare('SELECT id, username, timezone FROM users WHERE id = ?')
        .bind(userId ?? null)
        .first();
      return json({ success: true, user: profile }, {
        headers: { 'Set-Cookie': setSessionCookie(realToken, userId) },
      });
    }

    // ── LOGOUT ──────────────────────────────────────────────
    if (action === 'logout') {
      const session = cookies.get('ft_session');
      if (session) {
        const userIdStr = session.split(':')[0];
        if (userIdStr && !userIdStr.startsWith('reg:') && !userIdStr.startsWith('auth:')) {
          await db
            .prepare('DELETE FROM sessions WHERE user_id = ?')
            .bind(parseInt(userIdStr) ?? null)
            .run();
        }
      }
      return json(
        { success: true },
        { headers: { 'Set-Cookie': 'ft_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' } },
      );
    }

    return json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    console.error('auth POST error:', e?.message, e?.stack);
    return json({ error: 'Internal error', detail: e?.message || String(e) }, { status: 500 });
  }
};
