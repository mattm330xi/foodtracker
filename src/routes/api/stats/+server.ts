import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, platform, locals }) => {
  const db = platform!.env.FTD1;
  const userId = locals.userId;
  const days = parseInt(url.searchParams.get('days') || '7');

  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceIso = since.toISOString();

  const foods = await db.prepare(
    "SELECT text, substr(created_at, 1, 10) as date FROM entries WHERE user_id = ? AND text != '' AND created_at >= ? ORDER BY created_at DESC"
  ).bind(userId, sinceIso).all();

  const reacts = await db.prepare(
    "SELECT symptom, severity, notes, substr(created_at, 1, 10) as date FROM reactions WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC"
  ).bind(userId, sinceIso).all();

  const reactionDates = new Set(reacts.results.map((r: any) => r.date));

  const foodsByDate: Record<string, string[]> = {};
  for (const f of foods.results as any[]) {
    if (!foodsByDate[f.date]) foodsByDate[f.date] = [];
    foodsByDate[f.date].push(f.text);
  }

  const correlations: Array<{ food: string; reactionCount: number; dates: string[] }> = [];
  const foodReactionMap: Record<string, { count: number; dates: string[] }> = {};

  for (const [date, dayFoods] of Object.entries(foodsByDate)) {
    if (reactionDates.has(date)) {
      for (const food of dayFoods) {
        const key = food.toLowerCase().slice(0, 50);
        if (!foodReactionMap[key]) foodReactionMap[key] = { count: 0, dates: [] };
        foodReactionMap[key].count++;
        foodReactionMap[key].dates.push(date);
      }
    }
  }

  for (const [food, data] of Object.entries(foodReactionMap)) {
    correlations.push({ food, reactionCount: data.count, dates: data.dates });
  }
  correlations.sort((a, b) => b.reactionCount - a.reactionCount);

  return json({
    days,
    totalFoods: (foods.results as any[]).length,
    totalReactions: (reacts.results as any[]).length,
    reactions: reacts.results,
    correlations: correlations.slice(0, 10),
  });
};
