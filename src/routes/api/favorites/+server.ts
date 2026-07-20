import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, locals }) => {
  const db = platform!.env.FTD1;
  const userId = locals.userId;
  const { results } = await db.prepare(
    'SELECT * FROM favorites WHERE user_id = ? ORDER BY use_count DESC, created_at DESC LIMIT 20'
  ).bind(userId).all();
  return json(results);
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  const { text, image, meal } = await request.json();
  const db = platform!.env.FTD1;
  const userId = locals.userId;

  const existing = await db.prepare('SELECT id FROM favorites WHERE user_id = ? AND text = ?')
    .bind(userId, text).first();
  if (existing) {
    await db.prepare('UPDATE favorites SET use_count = use_count + 1 WHERE id = ? AND user_id = ?')
      .bind(existing.id, userId).run();
    return json({ id: existing.id, success: true });
  }

  const result = await db.prepare('INSERT INTO favorites (text, image, meal, user_id) VALUES (?, ?, ?, ?)')
    .bind(text, image || '', meal || 'Snacks', userId).run();
  return json({ id: result.meta.last_row_id, success: true });
};

export const DELETE: RequestHandler = async ({ request, platform, locals }) => {
  const { id } = await request.json();
  const db = platform!.env.FTD1;
  const userId = locals.userId;
  await db.prepare('DELETE FROM favorites WHERE id = ? AND user_id = ?').bind(id, userId).run();
  return json({ success: true });
};
