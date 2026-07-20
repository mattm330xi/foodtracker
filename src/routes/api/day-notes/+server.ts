import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, platform, locals }) => {
  const db = platform!.env.FTD1;
  const userId = locals.userId;
  const date = url.searchParams.get('date');
  if (!date) return json({ error: 'date required' }, { status: 400 });

  const row = await db.prepare('SELECT day_notes FROM entries WHERE user_id = ? AND date(created_at) = ? AND day_notes != "" LIMIT 1')
    .bind(userId, date).first();
  return json({ notes: row?.day_notes || '' });
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  const { date, notes } = await request.json();
  const db = platform!.env.FTD1;
  const userId = locals.userId;

  const existing = await db.prepare('SELECT id FROM entries WHERE user_id = ? AND date(created_at) = ? LIMIT 1')
    .bind(userId, date).first();
  if (existing) {
    await db.prepare('UPDATE entries SET day_notes = ? WHERE id = ? AND user_id = ?')
      .bind(notes, existing.id, userId).run();
  } else {
    await db.prepare("INSERT INTO entries (text, image, meal, day_notes, user_id) VALUES (?, '', 'Note', ?, ?)")
      .bind(date, notes, userId).run();
  }
  return json({ success: true });
};
