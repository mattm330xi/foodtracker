import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const RP_NAME = 'Food Tracker';
const RP_ID = 'foodtracker.mattm330xi.workers.dev';
const ORIGIN = `https://${RP_ID}`;

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
    return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
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

// ─── CBOR parser ───────────────────────────────────────────

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

async function verifyRegistration(credential: any, expectedChallenge: string) {
  try {
    const clientDataJSON = base64urlToBuf(credential.response.clientDataJSON);
    const attestationObject = base64urlToBuf(credential.response.attestationObject);
    const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));

    if (clientData.type !== 'webauthn.create') return null;
    if (clientData.challenge !== expectedChallenge) return null;
    if (clientData.origin !== ORIGIN) return null;

    const parsed = parseAttestationObject(attestationObject);
    if (!parsed) return null;

    return {
      credentialId: parsed.credentialId,
      publicKey: parsed.cosePublicKey,
      counter: parsed.signCount ?? 0,
    };
  } catch (e) {
    console.error('verifyRegistration:', e);
    return null;
  }
}

// ─── Handlers ──────────────────────────────────────────────

export const GET: RequestHandler = async ({ url, platform }) => {
  try {
    const username = url.searchParams.get('user');
    if (!username) return json({ error: 'user param required' }, { status: 400 });

    const db = platform!.env.FTD1;
    const user = await db.prepare('SELECT id FROM users WHERE username = ?').bind(username.trim().toLowerCase()).first() as any;
    if (!user) return json({ error: 'User not found' }, { status: 404 });

    const credCount = await db.prepare('SELECT COUNT(*) as cnt FROM credentials WHERE user_id = ?').bind(user.id).first() as any;
    if ((credCount?.cnt ?? 0) > 0) return json({ error: 'User already has passkeys — use normal login' }, { status: 400 });

    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const challenge = bufToBase64url(bytes.buffer);

    return json({
      options: {
        rp: { name: RP_NAME, id: RP_ID },
        user: {
          id: bufToBase64url(new TextEncoder().encode(String(user.id)).buffer),
          name: username.trim().toLowerCase(),
          displayName: username.trim().toLowerCase(),
        },
        challenge,
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        timeout: 60000,
        attestation: 'none',
      },
      _challenge: challenge,
      _userId: user.id,
    });
  } catch (e: any) {
    return json({ error: 'Internal error', detail: e?.message || String(e) }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ request, platform }) => {
  try {
    const { credential, challenge, userId } = await request.json();
    const db = platform!.env.FTD1;

    if (userId == null || credential == null || challenge == null) {
      return json({ error: 'Missing required fields' }, { status: 400 });
    }

    const user = await db.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first() as any;
    if (!user) return json({ error: 'User not found' }, { status: 404 });

    const credCount = await db.prepare('SELECT COUNT(*) as cnt FROM credentials WHERE user_id = ?').bind(userId).first() as any;
    if ((credCount?.cnt ?? 0) > 0) return json({ error: 'User already has passkeys' }, { status: 400 });

    const verified = await verifyRegistration(credential, challenge);
    if (!verified) return json({ error: 'Verification failed' }, { status: 400 });

    const pkBuf = new Uint8Array(base64urlToBuf(verified.publicKey));

    await db.prepare(
      'INSERT INTO credentials (user_id, credential_id, public_key, counter) VALUES (?, ?, ?, ?)'
    ).bind(
      userId ?? null,
      credential.id ?? null,
      pkBuf,
      verified.counter ?? 0,
    ).run();

    return json({ success: true, message: 'Passkey registered.' });
  } catch (e: any) {
    console.error('passkey-setup POST error:', e?.message, e?.stack);
    return json({ error: 'Internal setup error', detail: e?.message || String(e) }, { status: 500 });
  }
};
