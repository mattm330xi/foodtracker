import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, locals }) => {
  const db = platform!.env.FTD1;
  const userId = locals.userId;

  const { results } = await db.prepare(
    'SELECT id, ingredient, created_at FROM user_allergens WHERE user_id = ? ORDER BY ingredient ASC'
  ).bind(userId).all();

  return json({ allergens: results });
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  const { ingredient } = await request.json();
  const db = platform!.env.FTD1;
  const userId = locals.userId;

  const trimmed = (ingredient || '').trim().toLowerCase();
  if (!trimmed) return json({ error: 'Ingredient required' }, { status: 400 });

  try {
    await db.prepare(
      'INSERT INTO user_allergens (user_id, ingredient) VALUES (?, ?)'
    ).bind(userId, trimmed).run();
  } catch (e: any) {
    if (e?.message?.includes('UNIQUE')) {
      return json({ error: 'Already added' }, { status: 409 });
    }
    throw e;
  }

  return json({ success: true });
};

export const DELETE: RequestHandler = async ({ request, platform, locals }) => {
  const { id } = await request.json();
  const db = platform!.env.FTD1;
  const userId = locals.userId;

  await db.prepare(
    'DELETE FROM user_allergens WHERE id = ? AND user_id = ?'
  ).bind(id, userId).run();

  return json({ success: true });
};
