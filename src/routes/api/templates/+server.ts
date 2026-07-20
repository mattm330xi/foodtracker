import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, locals }) => {
  const db = platform!.env.FTD1;
  const userId = locals.userId;
  const { results } = await db.prepare(
    'SELECT * FROM meal_templates WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(userId).all();
  return json(results);
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  const { name, items } = await request.json();
  const db = platform!.env.FTD1;
  const userId = locals.userId;
  const result = await db.prepare('INSERT INTO meal_templates (name, items, user_id) VALUES (?, ?, ?)')
    .bind(name, typeof items === 'string' ? items : JSON.stringify(items), userId).run();
  return json({ id: result.meta.last_row_id, success: true });
};

export const DELETE: RequestHandler = async ({ request, platform, locals }) => {
  const { id } = await request.json();
  const db = platform!.env.FTD1;
  const userId = locals.userId;
  await db.prepare('DELETE FROM meal_templates WHERE id = ? AND user_id = ?').bind(id, userId).run();
  return json({ success: true });
};
