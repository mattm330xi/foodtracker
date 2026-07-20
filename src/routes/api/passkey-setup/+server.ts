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

// ─── CBOR parser ───────────────────────────────────────────

class CborReader {
  private view: DataView;
  private offset = 0;
  constructor(private buf: ArrayBuffer) { this.view = new DataView(buf); }

  readInfo(): [number, number] {
    const byte = this.view.getUint8(this.offset++);
    return [byte >> 5, byte & 0x1f];
  }

  readLength(): number {
    const [, info] = this.readInfo();
    if (info < 24) return info;
    if (info === 24) return this.view.getUint8(this.offset++);
    if (info === 25) { const v = this.view.getUint16(this.offset, false); this.offset += 2; return v; }
    if (info === 26) { const v = this.view.getUint32(this.offset, false); this.offset += 4; return v; }
    return 0;
  }

  readAny(): any {
    const [major, info] = this.readInfo();

    // Unsigned int
    if (major === 0) return info < 24 ? info : this.readAdditional(info);
    // Negative int
    if (major === 1) return -(this.readAdditional(info)) - 1;
    // Byte string
    if (major === 2) { const len = info < 24 ? info : this.readAdditional(info); const b = this.buf.slice(this.offset, this.offset + len); this.offset += len; return b; }
    // Text string
    if (major === 3) { const len = info < 24 ? info : this.readAdditional(info); const s = new TextDecoder().decode(this.buf.slice(this.offset, this.offset + len)); this.offset += len; return s; }
    // Array
    if (major === 4) { const len = info < 24 ? info : this.readAdditional(info); const arr = []; for (let i = 0; i < len; i++) arr.push(this.readAny()); return arr; }
    // Map
    if (major === 5) {
      const len = info < 24 ? info : this.readAdditional(info);
      const map: any = {};
      for (let i = 0; i < len; i++) { const key = this.readAny(); const val = this.readAny(); map[key] = val; }
      return map;
    }
    // Simple / float — skip
    this.offset++;
    return null;
  }

  readAdditional(info: number): number {
    if (info === 24) return this.view.getUint8(this.offset++);
    if (info === 25) { const v = this.view.getUint16(this.offset, false); this.offset += 2; return v; }
    if (info === 26) { const v = this.view.getUint32(this.offset, false); this.offset += 4; return v; }
    return 0;
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

  if (!(flags & 0x40)) return null;

  let offset = 53;
  const credIdLen = view.getUint16(offset, false); offset += 2;
  const credentialId = authData.slice(offset, offset + credIdLen);
  offset += credIdLen;
  const publicKey = authData.slice(offset).buffer;

  return { credentialId: bufToBase64url(credentialId.buffer), publicKey, signCount };
}

// ─── Verify ────────────────────────────────────────────────

async function verifyRegistration(credential: any, expectedChallenge: string) {
  try {
    const clientDataJSON = base64urlToBuf(credential.response.clientDataJSON);
    const attestationObject = base64urlToBuf(credential.response.attestationObject);
    const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));

    console.log('challenge match:', clientData.challenge === expectedChallenge, 'type:', clientData.type, 'origin match:', clientData.origin === ORIGIN);

    if (clientData.type !== 'webauthn.create') return null;
    if (clientData.challenge !== expectedChallenge) return null;
    if (clientData.origin !== ORIGIN) return null;

    return parseAttestationObject(attestationObject);
  } catch (e) {
    console.error('verifyRegistration:', e);
    return null;
  }
}

// ─── Handlers ──────────────────────────────────────────────

export const GET: RequestHandler = async ({ url, platform }) => {
  const username = url.searchParams.get('user');
  if (!username) return json({ error: 'user param required' }, { status: 400 });

  const db = platform!.env.FTD1;
  const user = await db.prepare('SELECT id FROM users WHERE username = ?').bind(username.trim().toLowerCase()).first() as any;
  if (!user) return json({ error: 'User not found' }, { status: 404 });

  const credCount = await db.prepare('SELECT COUNT(*) as cnt FROM credentials WHERE user_id = ?').bind(user.id).first() as any;
  if (credCount.cnt > 0) return json({ error: 'User already has passkeys — use normal login' }, { status: 400 });

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
};

export const POST: RequestHandler = async ({ request, platform }) => {
  const { credential, challenge, userId } = await request.json();
  const db = platform!.env.FTD1;

  const user = await db.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first() as any;
  if (!user) return json({ error: 'User not found' }, { status: 404 });

  const credCount = await db.prepare('SELECT COUNT(*) as cnt FROM credentials WHERE user_id = ?').bind(userId).first() as any;
  if (credCount.cnt > 0) return json({ error: 'User already has passkeys' }, { status: 400 });

  const verified = await verifyRegistration(credential, challenge);
  if (!verified) return json({ error: 'Verification failed' }, { status: 400 });

  await db.prepare(
    'INSERT INTO credentials (user_id, credential_id, public_key, counter) VALUES (?, ?, ?, ?)'
  ).bind(userId, credential.id, new Uint8Array(verified.publicKey), verified.signCount).run();

  return json({ success: true, message: 'Passkey registered.' });
};
