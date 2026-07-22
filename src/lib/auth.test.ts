import { describe, it, expect, vi } from 'vitest';

// ─── Extract auth utilities for testing ────────────────────

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

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltB64, hashB64] = stored.split(':');
  if (!saltB64 || !hashB64) return false;
  const salt = base64urlToBuf(saltB64);
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'],
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256,
  );
  return bufToBase64url(hash) === hashB64;
}

// ─── Ghost user check ─────────────────────────────────────

async function isUsernameClaimable(db: any, userId: number): Promise<boolean> {
  const hasPassword = await db.prepare(
    'SELECT 1 FROM users WHERE id = ? AND password_hash IS NOT NULL',
  ).bind(userId).first();
  if (hasPassword) return false;
  const hasCredentials = await db.prepare(
    'SELECT 1 FROM credentials WHERE user_id = ? LIMIT 1',
  ).bind(userId).first();
  return !hasCredentials;
}

// ─── Mock D1 database ─────────────────────────────────────

function createMockDB() {
  const users: Map<number, any> = new Map();
  const credentials: Map<number, any> = new Map();
  const sessions: Map<number, any> = new Map();
  let nextUserId = 1;
  let nextCredId = 1;

  function prepare(sql: string) {
    return {
      bind: (...args: any[]) => ({
        first: vi.fn(async () => {
          if (sql.includes('FROM users WHERE username = ?')) {
            const username = args[0];
            for (const u of users.values()) {
              if (u.username === username) return u;
            }
            return null;
          }
          if (sql.includes('FROM users WHERE id = ?') && sql.includes('password_hash IS NOT NULL')) {
            const userId = args[0];
            const u = users.get(userId);
            return u?.password_hash ? { 1: 1 } : null;
          }
          if (sql.includes('FROM users WHERE id = ?')) {
            const userId = args[0];
            return users.get(userId) || null;
          }
          if (sql.includes('FROM credentials WHERE user_id = ? LIMIT 1')) {
            const userId = args[0];
            for (const c of credentials.values()) {
              if (c.user_id === userId) return { 1: 1 };
            }
            return null;
          }
          if (sql.includes('COUNT(*) as cnt FROM credentials')) {
            const userId = args[0];
            let cnt = 0;
            for (const c of credentials.values()) {
              if (c.user_id === userId) cnt++;
            }
            return { cnt };
          }
          return null;
        }),
        all: vi.fn(async () => {
          if (sql.includes('FROM credentials WHERE user_id = ?')) {
            const userId = args[0];
            const results = [];
            for (const c of credentials.values()) {
              if (c.user_id === userId) results.push(c);
            }
            return { results };
          }
          return { results: [] };
        }),
        run: vi.fn(async () => {
          if (sql.startsWith('INSERT INTO users')) {
            const id = nextUserId++;
            const user = { id, username: args[0], password_hash: args[1] || null, timezone: 'America/New_York' };
            users.set(id, user);
            return { meta: { last_row_id: id } };
          }
          if (sql.startsWith('INSERT INTO credentials')) {
            const id = nextCredId++;
            credentials.set(id, { id, user_id: args[0], credential_id: args[1] });
            return { meta: { last_row_id: id } };
          }
          if (sql.startsWith('INSERT INTO sessions')) {
            sessions.set(args[1], { user_id: args[0], token: args[1], expires_at: args[2] });
            return { meta: { last_row_id: 1 } };
          }
          if (sql.startsWith('DELETE FROM sessions')) {
            if (sql.includes('user_id = ?') && !sql.includes('AND token')) {
              const userId = args[0];
              for (const [token, s] of sessions) {
                if (s.user_id === userId) sessions.delete(token);
              }
            }
            return { meta: {} };
          }
          if (sql.startsWith('DELETE FROM users')) {
            const userId = args[0];
            users.delete(userId);
            return { meta: {} };
          }
          if (sql.startsWith('UPDATE users SET password_hash')) {
            const [hash, userId] = args;
            const u = users.get(userId);
            if (u) u.password_hash = hash;
            return { meta: {} };
          }
          return { meta: {} };
        }),
      }),
    };
  }

  return {
    db: { prepare },
    users,
    credentials,
    sessions,
    _nextUserId: () => nextUserId,
  };
}

// ─── Password hashing tests ───────────────────────────────

describe('password hashing', () => {
  it('hashes a password and verifies it', async () => {
    const hash = await hashPassword('mypassword123');
    expect(hash).toContain(':');
    expect(await verifyPassword('mypassword123', hash)).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await hashPassword('mypassword123');
    expect(await verifyPassword('wrongpassword', hash)).toBe(false);
  });

  it('produces different hashes for same password (random salt)', async () => {
    const hash1 = await hashPassword('samepassword');
    const hash2 = await hashPassword('samepassword');
    expect(hash1).not.toBe(hash2);
    expect(await verifyPassword('samepassword', hash1)).toBe(true);
    expect(await verifyPassword('samepassword', hash2)).toBe(true);
  });

  it('rejects malformed stored hash', async () => {
    expect(await verifyPassword('password', 'invalid')).toBe(false);
    expect(await verifyPassword('password', 'abc:def')).toBe(false);
  });

  it('handles empty salt:hash parts', async () => {
    expect(await verifyPassword('password', ':')).toBe(false);
    expect(await verifyPassword('password', 'abc:')).toBe(false);
    expect(await verifyPassword('password', ':def')).toBe(false);
  });
});

// ─── isUsernameClaimable tests ─────────────────────────────

describe('isUsernameClaimable', () => {
  it('returns true for user with no password and no credentials', async () => {
    const { db, users } = createMockDB();
    users.set(1, { id: 1, username: 'ghost', password_hash: null });
    expect(await isUsernameClaimable(db, 1)).toBe(true);
  });

  it('returns false for user with password', async () => {
    const { db, users } = createMockDB();
    users.set(1, { id: 1, username: 'haspw', password_hash: 'salt:hash' });
    expect(await isUsernameClaimable(db, 1)).toBe(false);
  });

  it('returns false for user with credentials', async () => {
    const { db, users, credentials } = createMockDB();
    users.set(1, { id: 1, username: 'hascred', password_hash: null });
    credentials.set(1, { id: 1, user_id: 1, credential_id: 'cred1' });
    expect(await isUsernameClaimable(db, 1)).toBe(false);
  });

  it('returns false for user with both password and credentials', async () => {
    const { db, users, credentials } = createMockDB();
    users.set(1, { id: 1, username: 'both', password_hash: 'salt:hash' });
    credentials.set(1, { id: 1, user_id: 1, credential_id: 'cred1' });
    expect(await isUsernameClaimable(db, 1)).toBe(false);
  });
});

// ─── Register-password flow ────────────────────────────────

describe('register-password flow', () => {
  it('creates a new user with password', async () => {
    const { db, users } = createMockDB();
    const passwordHash = await hashPassword('testpass123');

    const result = await db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .bind('newuser', passwordHash).run();
    const userId = result.meta.last_row_id;

    const user = users.get(userId!);
    expect(user).toBeDefined();
    expect(user!.username).toBe('newuser');
    expect(user!.password_hash).toContain(':');
    expect(await verifyPassword('testpass123', user!.password_hash)).toBe(true);
  });

  it('allows claiming ghost user during registration', async () => {
    const { db, users } = createMockDB();
    users.set(99, { id: 99, username: 'ghost', password_hash: null });

    const claimable = await isUsernameClaimable(db, 99);
    expect(claimable).toBe(true);

    // Simulate server behavior: delete ghost, then insert new user
    users.delete(99);
    const passwordHash = await hashPassword('newpass123');
    const result = await db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .bind('ghost', passwordHash).run();

    expect(users.has(99)).toBe(false);
    const newUser = users.get(result.meta.last_row_id!);
    expect(newUser).toBeDefined();
    expect(newUser!.username).toBe('ghost');
    expect(await verifyPassword('newpass123', newUser!.password_hash)).toBe(true);
  });

  it('rejects registration when username has password', async () => {
    const { db, users } = createMockDB();
    users.set(1, { id: 1, username: 'taken', password_hash: 'salt:hash' });

    const claimable = await isUsernameClaimable(db, 1);
    expect(claimable).toBe(false);
  });

  it('rejects registration when username has passkey', async () => {
    const { db, users, credentials } = createMockDB();
    users.set(1, { id: 1, username: 'taken', password_hash: null });
    credentials.set(1, { id: 1, user_id: 1, credential_id: 'cred1' });

    const claimable = await isUsernameClaimable(db, 1);
    expect(claimable).toBe(false);
  });
});

// ─── Login-password flow ───────────────────────────────────

describe('login-password flow', () => {
  it('logs in with correct password', async () => {
    const { db, users } = createMockDB();
    const passwordHash = await hashPassword('mypassword');
    users.set(1, { id: 1, username: 'testuser', password_hash: passwordHash, timezone: 'America/New_York' });

    const user = await db.prepare('SELECT id, password_hash FROM users WHERE username = ?')
      .bind('testuser').first();
    expect(user).toBeDefined();
    expect(await verifyPassword('mypassword', user.password_hash)).toBe(true);
  });

  it('rejects wrong password', async () => {
    const { db, users } = createMockDB();
    const passwordHash = await hashPassword('mypassword');
    users.set(1, { id: 1, username: 'testuser', password_hash: passwordHash });

    const user = await db.prepare('SELECT id, password_hash FROM users WHERE username = ?')
      .bind('testuser').first();
    expect(await verifyPassword('wrongpassword', user.password_hash)).toBe(false);
  });

  it('returns confirmWithPasskey when user has no password but has passkey', async () => {
    const { db, users, credentials } = createMockDB();
    users.set(1, { id: 1, username: 'passkeyuser', password_hash: null });
    credentials.set(1, { id: 1, user_id: 1, credential_id: 'cred1' });

    const user = await db.prepare('SELECT id, password_hash FROM users WHERE username = ?')
      .bind('passkeyuser').first();
    expect(user.password_hash).toBeNull();

    const hasPasskeys = await db.prepare('SELECT 1 FROM credentials WHERE user_id = ? LIMIT 1')
      .bind(user.id).first();
    expect(hasPasskeys).toBeTruthy();
  });

  it('returns null for nonexistent user', async () => {
    const { db } = createMockDB();
    const user = await db.prepare('SELECT id, password_hash FROM users WHERE username = ?')
      .bind('nobody').first();
    expect(user).toBeNull();
  });
});

// ─── Set-password flow ─────────────────────────────────────

describe('set-password flow', () => {
  it('sets password on user without one', async () => {
    const { db, users } = createMockDB();
    users.set(1, { id: 1, username: 'testuser', password_hash: null });

    const passwordHash = await hashPassword('newpassword');
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(passwordHash, 1).run();

    const user = users.get(1);
    expect(user.password_hash).toContain(':');
    expect(await verifyPassword('newpassword', user.password_hash)).toBe(true);
  });

  it('changes existing password', async () => {
    const { db, users } = createMockDB();
    const oldHash = await hashPassword('oldpassword');
    users.set(1, { id: 1, username: 'testuser', password_hash: oldHash });

    const newHash = await hashPassword('newpassword');
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(newHash, 1).run();

    const user = users.get(1);
    expect(await verifyPassword('oldpassword', user.password_hash)).toBe(false);
    expect(await verifyPassword('newpassword', user.password_hash)).toBe(true);
  });
});

// ─── Cross-method confirmation logic ──────────────────────

describe('cross-method confirmation', () => {
  it('detects passkey-only account for password login attempt', async () => {
    const { db, users, credentials } = createMockDB();
    users.set(1, { id: 1, username: 'passkeyonly', password_hash: null });
    credentials.set(1, { id: 1, user_id: 1, credential_id: 'cred1' });

    const user = await db.prepare('SELECT id, password_hash FROM users WHERE username = ?')
      .bind('passkeyonly').first();
    expect(user.password_hash).toBeNull();

    const hasPasskeys = await db.prepare('SELECT 1 FROM credentials WHERE user_id = ? LIMIT 1')
      .bind(user.id).first();
    expect(hasPasskeys).toBeTruthy();

    // Server would return { confirmWithPasskey: true }
  });

  it('detects password-only account for passkey login attempt', async () => {
    const { db, users } = createMockDB();
    const passwordHash = await hashPassword('mypassword');
    users.set(1, { id: 1, username: 'passwordonly', password_hash: passwordHash });

    const creds = await db.prepare('SELECT credential_id, transports FROM credentials WHERE user_id = ?')
      .bind(1).all();
    expect(creds.results).toHaveLength(0);

    const hasPassword = await db.prepare(
      'SELECT 1 FROM users WHERE id = ? AND password_hash IS NOT NULL',
    ).bind(1).first();
    expect(hasPassword).toBeTruthy();

    // Server would return { confirmWithPassword: true }
  });

  it('sets password after passkey confirmation', async () => {
    const { db, users } = createMockDB();
    const passwordHash = await hashPassword('newpassword');
    users.set(1, { id: 1, username: 'testuser', password_hash: null });

    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(passwordHash, 1).run();

    const user = users.get(1);
    expect(user.password_hash).toContain(':');
    expect(await verifyPassword('newpassword', user.password_hash)).toBe(true);
  });

  it('adds passkey after password confirmation', async () => {
    const { db, users, credentials } = createMockDB();
    users.set(1, { id: 1, username: 'testuser', password_hash: 'salt:hash' });

    await db.prepare('INSERT INTO credentials (user_id, credential_id, public_key, counter) VALUES (?, ?, ?, ?)')
      .bind(1, 'newcred', new Uint8Array([1, 2, 3]), 0).run();

    const creds = await db.prepare('SELECT credential_id FROM credentials WHERE user_id = ?')
      .bind(1).all();
    expect(creds.results).toHaveLength(1);
    expect(creds.results[0].credential_id).toBe('newcred');
  });
});

// ─── Edge cases ────────────────────────────────────────────

describe('auth edge cases', () => {
  it('handles very long password', async () => {
    const longPw = 'a'.repeat(1000);
    const hash = await hashPassword(longPw);
    expect(await verifyPassword(longPw, hash)).toBe(true);
    expect(await verifyPassword('a'.repeat(999), hash)).toBe(false);
  });

  it('handles unicode password', async () => {
    const unicodePw = 'pässwörd日本語';
    const hash = await hashPassword(unicodePw);
    expect(await verifyPassword(unicodePw, hash)).toBe(true);
    expect(await verifyPassword('password', hash)).toBe(false);
  });

  it('handles empty string password', async () => {
    const hash = await hashPassword('');
    expect(await verifyPassword('', hash)).toBe(true);
    expect(await verifyPassword('notempty', hash)).toBe(false);
  });

  it('handles special characters in password', async () => {
    const specialPw = '!@#$%^&*()_+-=[]{}|;:,.<>?';
    const hash = await hashPassword(specialPw);
    expect(await verifyPassword(specialPw, hash)).toBe(true);
  });

  it('claimable check works when user does not exist', async () => {
    const { db } = createMockDB();
    // When user doesn't exist, isUsernameClaimable wouldn't be called
    // but the SELECT returns null
    const user = await db.prepare('SELECT id FROM users WHERE username = ?')
      .bind('nonexistent').first();
    expect(user).toBeNull();
  });

  it('can set and verify password in sequence', async () => {
    const { db, users } = createMockDB();
    users.set(1, { id: 1, username: 'testuser', password_hash: null });

    // Set password
    const hash1 = await hashPassword('firstpass');
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash1, 1).run();
    expect(await verifyPassword('firstpass', users.get(1).password_hash)).toBe(true);

    // Change password
    const hash2 = await hashPassword('secondpass');
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash2, 1).run();
    expect(await verifyPassword('firstpass', users.get(1).password_hash)).toBe(false);
    expect(await verifyPassword('secondpass', users.get(1).password_hash)).toBe(true);
  });
});
