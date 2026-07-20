import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, platform }) => {
  const db = platform!.env.FTD1;
  const date = url.searchParams.get('date');

  if (date) {
    const { results } = await db.prepare(
      "SELECT * FROM entries WHERE date(created_at) = ? ORDER BY created_at DESC"
    ).bind(date).all();
    return json(results);
  }

  const { results } = await db.prepare('SELECT * FROM entries ORDER BY created_at DESC LIMIT 50').all();
  return json(results);
};

export const POST: RequestHandler = async ({ request, platform }) => {
  const { text, image } = await request.json();
  const db = platform!.env.FTD1;
  const result = await db.prepare('INSERT INTO entries (text, image) VALUES (?, ?)').bind(text || '', image || '').run();
  return json({ id: result.meta.last_row_id, success: true });
};

export const DELETE: RequestHandler = async ({ request, platform }) => {
  const { id } = await request.json();
  const db = platform!.env.FTD1;
  await db.prepare('DELETE FROM entries WHERE id = ?').bind(id).run();
  return json({ success: true });
};
