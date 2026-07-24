import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dateRange } from '$lib/dateRange';

export const GET: RequestHandler = async ({ url, platform, locals }) => {
  const db = platform!.env.FTD1;
  const userId = locals.userId;
  const date = url.searchParams.get('date');
  if (!date) return json({ error: 'date required' }, { status: 400 });

  const tz = locals.timezone || 'America/New_York';
  const { start, end } = dateRange(date, tz);
  const row = await db.prepare('SELECT day_notes FROM entries WHERE user_id = ? AND created_at >= ? AND created_at < ? AND day_notes != "" LIMIT 1')
    .bind(userId, start, end).first();
  return json({ notes: row?.day_notes || '' });
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  const { date, notes } = await request.json();
  const db = platform!.env.FTD1;
  const userId = locals.userId;

  const tz = locals.timezone || 'America/New_York';
  const { start, end } = dateRange(date, tz);
  const existing = await db.prepare('SELECT id FROM entries WHERE user_id = ? AND created_at >= ? AND created_at < ? LIMIT 1')
    .bind(userId, start, end).first();
  if (existing) {
    await db.prepare('UPDATE entries SET day_notes = ? WHERE id = ? AND user_id = ?')
      .bind(notes, existing.id, userId).run();
  } else {
    await db.prepare("INSERT INTO entries (text, image, meal, day_notes, user_id, created_at) VALUES (?, '', 'Note', ?, ?, ?)")
      .bind(date, notes, userId, start).run();
  }
  return json({ success: true });
};
