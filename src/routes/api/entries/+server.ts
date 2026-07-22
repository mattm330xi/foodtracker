import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dateRange } from '$lib/dateRange';

export const GET: RequestHandler = async ({ url, platform, locals }) => {
  const db = platform!.env.FTD1;
  const userId = locals.userId;
  const date = url.searchParams.get('date');

  if (date) {
    const { start, end } = dateRange(date);
    const { results } = await db.prepare(
      "SELECT * FROM entries WHERE user_id = ? AND created_at >= ? AND created_at < ? ORDER BY created_at ASC"
    ).bind(userId, start, end).all();
    return json(results);
  }

  const { results } = await db.prepare(
    'SELECT * FROM entries WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).bind(userId).all();
  return json(results);
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  const { text, image, meal, barcode_data, date } = await request.json();
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

  let createdAt: string;
  if (date) {
    const tz = locals.timezone || 'America/New_York';
    const now = new Date();
    const timePart = now.toLocaleString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      timeZone: tz,
    });
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    createdAt = `${date}T${timePart}.${ms}Z`;
  } else {
    createdAt = new Date().toISOString();
  }

  const result = await db.prepare(
    'INSERT INTO entries (text, image, meal, user_id, created_at, barcode_data) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(text || '', image || '', autoMeal, userId, createdAt, barcode_data || null).run();
  return json({ id: result.meta.last_row_id, success: true, meal: autoMeal });
};

export const PATCH: RequestHandler = async ({ request, platform, locals }) => {
  const { id, meal, created_at, text } = await request.json();
  const db = platform!.env.FTD1;
  const userId = locals.userId;

  const fields: string[] = [];
  const values: unknown[] = [];
  if (meal !== undefined) { fields.push('meal = ?'); values.push(meal); }
  if (created_at !== undefined) { fields.push('created_at = ?'); values.push(created_at); }
  if (text !== undefined) { fields.push('text = ?'); values.push(text); }

  if (fields.length > 0) {
    await db.prepare(`UPDATE entries SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`)
      .bind(...values, id, userId).run();
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
