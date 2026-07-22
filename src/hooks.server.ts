import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  const url = event.url.pathname;

  // Skip auth for login page, auth API, barcode API, and static assets
  if (
    url === '/login' ||
    url.startsWith('/api/auth') ||
    url.startsWith('/api/barcode') ||
    url.startsWith('/_app') ||
    url === '/manifest.json' ||
    url === '/sw.js' ||
    url.endsWith('.js') ||
    url.endsWith('.css') ||
    url.endsWith('.png') ||
    url.endsWith('.svg')
  ) {
    return resolve(event);
  }

  // Check session cookie
  const session = event.cookies.get('ft_session');
  if (!session) {
    // API routes get 401, pages redirect to login
    if (url.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(null, {
      status: 302,
      headers: { Location: '/login' }
    });
  }

  const [userIdStr, token] = session.split(':');
  if (!userIdStr || !token) {
    if (url.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(null, {
      status: 302,
      headers: { Location: '/login' }
    });
  }

  const db = (event.platform as any)?.env?.FTD1;
  if (!db) {
    return new Response('Database not available', { status: 500 });
  }

  const row = await db.prepare(
    "SELECT u.id, u.username, u.timezone FROM users u JOIN sessions s ON u.id = s.user_id WHERE s.user_id = ? AND s.token = ? AND s.expires_at > datetime('now') LIMIT 1"
  ).bind(parseInt(userIdStr), token).first();

  if (!row) {
    event.cookies.delete('ft_session', { path: '/' });
    if (url.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Session expired' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(null, {
      status: 302,
      headers: { Location: '/login' }
    });
  }

  // Attach user info to locals
  event.locals.userId = row.id;
  event.locals.username = row.username;
  event.locals.timezone = row.timezone;

  // Rolling expiry: push the session (DB row + cookie) another 60 days out on every request,
  // so an active user is never logged out purely because 60 days passed since their last login.
  const ROLLING_SESSION_MS = 60 * 24 * 60 * 60 * 1000;
  const newExpiresIso = new Date(Date.now() + ROLLING_SESSION_MS).toISOString();
  await db.prepare(
    'UPDATE sessions SET expires_at = ? WHERE user_id = ? AND token = ?'
  ).bind(newExpiresIso, parseInt(userIdStr), token).run();
  event.cookies.set('ft_session', session, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: ROLLING_SESSION_MS / 1000
  });

  return resolve(event);
};
