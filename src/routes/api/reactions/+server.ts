import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, platform, locals }) => {
  const db = platform!.env.FTD1;
  const userId = locals.userId;
  const date = url.searchParams.get('date');

  if (date) {
    const { results } = await db.prepare(
      "SELECT * FROM reactions WHERE user_id = ? AND date(created_at) = ? ORDER BY created_at ASC"
    ).bind(userId, date).all();
    return json(results);
  }

  const { results } = await db.prepare(
    'SELECT * FROM reactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).bind(userId).all();
  return json(results);
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  const { symptom, severity, notes } = await request.json();
  const db = platform!.env.FTD1;
  const userId = locals.userId;
  const result = await db.prepare(
    'INSERT INTO reactions (symptom, severity, notes, user_id, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(symptom, severity || 1, notes || '', userId, new Date().toISOString()).run();
  return json({ id: result.meta.last_row_id, success: true });
};

export const DELETE: RequestHandler = async ({ request, platform, locals }) => {
  const { id } = await request.json();
  const db = platform!.env.FTD1;
  const userId = locals.userId;
  await db.prepare('DELETE FROM reactions WHERE id = ? AND user_id = ?').bind(id, userId).run();
  return json({ success: true });
};
