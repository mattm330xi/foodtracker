import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, platform, locals }) => {
  const db = platform!.env.FTD1;
  const userId = locals.userId;
  const date = url.searchParams.get('date');

  if (date) {
    const { results } = await db.prepare(
      "SELECT * FROM entries WHERE user_id = ? AND date(created_at) = ? ORDER BY created_at ASC"
    ).bind(userId, date).all();
    return json(results);
  }

  const { results } = await db.prepare(
    'SELECT * FROM entries WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).bind(userId).all();
  return json(results);
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  const { text, image, meal } = await request.json();
  const db = platform!.env.FTD1;
  const userId = locals.userId;

  let autoMeal = meal;
  if (!autoMeal) {
    const tz = locals.timezone || 'America/New_York';
    const hour = parseInt(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: tz }));
    if (hour >= 5 && hour < 10) autoMeal = 'Breakfast';
    else if (hour >= 10 && hour < 15) autoMeal = 'Lunch';
    else if (hour >= 17 && hour < 21) autoMeal = 'Dinner';
    else autoMeal = 'Snacks';
  }

  const result = await db.prepare(
    'INSERT INTO entries (text, image, meal, user_id, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(text || '', image || '', autoMeal, userId, new Date().toISOString()).run();
  return json({ id: result.meta.last_row_id, success: true, meal: autoMeal });
};

export const PATCH: RequestHandler = async ({ request, platform, locals }) => {
  const { id, meal, created_at } = await request.json();
  const db = platform!.env.FTD1;
  const userId = locals.userId;

  if (meal !== undefined && created_at !== undefined) {
    await db.prepare('UPDATE entries SET meal = ?, created_at = ? WHERE id = ? AND user_id = ?')
      .bind(meal, created_at, id, userId).run();
  } else if (meal !== undefined) {
    await db.prepare('UPDATE entries SET meal = ? WHERE id = ? AND user_id = ?')
      .bind(meal, id, userId).run();
  } else if (created_at !== undefined) {
    await db.prepare('UPDATE entries SET created_at = ? WHERE id = ? AND user_id = ?')
      .bind(created_at, id, userId).run();
  }

  return json({ success: true });
};

export const DELETE: RequestHandler = async ({ request, platform, locals }) => {
  const { id } = await request.json();
  const db = platform!.env.FTD1;
  const userId = locals.userId;
  await db.prepare('DELETE FROM entries WHERE id = ? AND user_id = ?').bind(id, userId).run();
  return json({ success: true });
};
