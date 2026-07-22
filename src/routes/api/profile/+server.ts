import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const RP_NAME = 'Food Tracker';

function getRpId(origin: string): string {
  return new URL(origin).hostname;
}

function getOrigin(request: Request): string {
  return new URL(request.url).origin;
}

function generateChallenge(): string {
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

// ─── Minimal CBOR reader (same as auth API) ────────────────

class CborReader {
  private view: DataView;
  private offset = 0;
  constructor(private buf: ArrayBuffer) { this.view = new DataView(buf); }
  readMajor(): [number, number] {
    const byte = this.view.getUint8(this.offset++);
    const major = byte >> 5, info = byte & 0x1f;
    if (info < 24) return [major, info];
    if (info === 24) return [major, this.view.getUint8(this.offset++)];
    if (info === 25) { const v = this.view.getUint16(this.offset, false); this.offset += 2; return [major, v]; }
    if (info === 26) { const v = this.view.getUint32(this.offset, false); this.offset += 4; return [major, v]; }
    return [major, 0];
  }
  readInt(): number {
    const [major, val] = this.readMajor();
    return major === 0 ? val : major === 1 ? -1 - val : 0;
  }
  readBytes(): ArrayBuffer {
    const [major, len] = this.readMajor();
    const bytes = this.buf.slice(this.offset, this.offset + len);
    this.offset += len;
    return bytes;
  }
  readMap(): Map<number, any> {
    const [major, count] = this.readMajor();
    const map = new Map<number, any>();
    for (let i = 0; i < count; i++) { map.set(this.readInt(), this.readAny()); }
    return map;
  }
  readAny(): any {
    const peek = this.view.getUint8(this.offset);
    const major = peek >> 5;
    if (major <= 1) return this.readInt();
    if (major === 2) return this.readBytes();
    if (major === 5) return this.readMap();
    this.offset++;
    return null;
  }
}

function parseAttestationObject(buf: ArrayBuffer) {
  const map = new CborReader(buf).readMap();
  const authData = new Uint8Array(map.get(2) as ArrayBuffer);
  const view = new DataView(authData.buffer as ArrayBuffer, authData.byteOffset, authData.byteLength);
  let offset = 36; // skip rpIdHash(32) + flags(1) + signCount(4)
  const flags = view.getUint8(32);
  if (flags & 0x40) { // AT flag set
    const credIdLen = view.getUint16(offset, false); offset += 2;
    const credentialId = authData.slice(offset, offset + credIdLen);
    offset += credIdLen;
    const publicKey = authData.slice(offset).buffer;
    return { credentialId: bufToBase64url(credentialId.buffer), publicKey, signCount: view.getUint32(32 + 1, false) };
  }
  return null;
}

async function verifyRegistration(credential: any, expectedChallenge: string, expectedOrigin: string) {
  try {
    const clientDataJSON = base64urlToBuf(credential.response.clientDataJSON);
    const attestationObject = base64urlToBuf(credential.response.attestationObject);
    const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));
    if (clientData.type !== 'webauthn.create' || clientData.challenge !== expectedChallenge || clientData.origin !== expectedOrigin) return null;
    return parseAttestationObject(attestationObject);
  } catch { return null; }
}

// ─── Password hashing (PBKDF2-SHA256) ─────────────────────

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'],
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256,
  );
  return `${bufToBase64url(salt.buffer)}:${bufToBase64url(hash)}`;
}

export const GET: RequestHandler = async ({ url, platform, locals }) => {
  const action = url.searchParams.get('action');
  const db = platform!.env.FTD1;
  const userId = locals.userId;

  if (action === 'list-credentials') {
    const { results } = await db.prepare(
      'SELECT id, credential_id, created_at FROM credentials WHERE user_id = ? ORDER BY created_at DESC'
    ).bind(userId).all();
    return json({ credentials: results });
  }

  if (action === 'check-auth-methods') {
    const user = await db.prepare('SELECT password_hash FROM users WHERE id = ?').bind(userId).first() as any;
    const credCount = await db.prepare('SELECT COUNT(*) as cnt FROM credentials WHERE user_id = ?').bind(userId).first() as any;
    return json({ hasPassword: !!user?.password_hash, passkeyCount: credCount?.cnt ?? 0 });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
};

export const POST: RequestHandler = async ({ request, platform, locals, cookies }) => {
  const { action, ...body } = await request.json();
  const db = platform!.env.FTD1;
  const userId = locals.userId;
  const rpId = getRpId(getOrigin(request));
  const origin = `https://${rpId}`;

  // ── TIMEZONE ─────────────────────────────────────────────
  if (body.timezone) {
    await db.prepare('UPDATE users SET timezone = ? WHERE id = ?').bind(body.timezone, userId).run();
    return json({ success: true });
  }

  // ── SET PASSWORD ─────────────────────────────────────────
  if (action === 'set-password') {
    const { password } = body;
    if (!password) return json({ error: 'Password required' }, { status: 400 });
    if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    const passwordHash = await hashPassword(password);
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash, userId).run();
    return json({ success: true });
  }

  // ── ADD PASSKEY START ────────────────────────────────────
  if (action === 'add-passkey-start') {
    const challenge = generateChallenge();
    const user = await db.prepare('SELECT username FROM users WHERE id = ?').bind(userId).first() as any;
    const existingCreds = await db.prepare('SELECT credential_id FROM credentials WHERE user_id = ?').bind(userId).all();

    return json({
      options: {
        rp: { name: RP_NAME, id: rpId },
        user: {
          id: bufToBase64url(new TextEncoder().encode(String(userId)).buffer),
          name: user.username,
          displayName: user.username,
        },
        challenge,
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
        timeout: 60000,
        attestation: 'none',
        excludeCredentials: existingCreds.results.map((c: any) => ({ id: c.credential_id, type: 'public-key' })),
      }
    }, {
      headers: { 'Set-Cookie': `ft_passkey_challenge=${challenge}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=120` }
    });
  }

  // ── ADD PASSKEY FINISH ───────────────────────────────────
  if (action === 'add-passkey-finish') {
    const challenge = cookies.get('ft_passkey_challenge');
    if (!challenge) return json({ error: 'No passkey registration in progress' }, { status: 401 });

    const verified = await verifyRegistration(body.credential, challenge, origin);
    if (!verified) return json({ error: 'Verification failed' }, { status: 400 });

    await db.prepare(
      'INSERT INTO credentials (user_id, credential_id, public_key, counter) VALUES (?, ?, ?, ?)'
    ).bind(userId, verified.credentialId, new Uint8Array(verified.publicKey), verified.signCount).run();

    return json({ success: true }, {
      headers: { 'Set-Cookie': 'ft_passkey_challenge=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' }
    });
  }

  // ── REMOVE PASSKEY ───────────────────────────────────────
  if (action === 'remove-passkey') {
    const credCount = await db.prepare('SELECT COUNT(*) as cnt FROM credentials WHERE user_id = ?').bind(userId).first() as any;
    if (credCount.cnt <= 1) return json({ error: 'Cannot remove your last passkey' }, { status: 400 });

    await db.prepare('DELETE FROM credentials WHERE id = ? AND user_id = ?')
      .bind(body.credentialId, userId).run();
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
};
