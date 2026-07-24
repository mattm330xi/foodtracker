import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dateRange, shiftDateStr, isoToLocalDateStr } from '$lib/dateRange';

export const GET: RequestHandler = async ({ url, platform, locals }) => {
  const db = platform!.env.FTD1;
  const userId = locals.userId;
  const days = parseInt(url.searchParams.get('days') || '7');
  const tz = locals.timezone || 'America/New_York';

  // "Today" and the window start, both anchored to the user's local calendar day —
  // not the server's (always-UTC) clock — so late-evening entries in UTC-negative
  // timezones land in the correct day's bucket instead of tomorrow's.
  const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const sinceDateStr = shiftDateStr(todayLocal, -(days - 1));
  const sinceIso = dateRange(sinceDateStr, tz).start;

  const foods = await db.prepare(
    "SELECT text, created_at FROM entries WHERE user_id = ? AND text != '' AND created_at >= ? ORDER BY created_at DESC"
  ).bind(userId, sinceIso).all();

  const reacts = await db.prepare(
    "SELECT symptom, severity, notes, created_at FROM reactions WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC"
  ).bind(userId, sinceIso).all();

  const reactsWithLocalDate = (reacts.results as any[]).map((r) => ({ ...r, date: isoToLocalDateStr(r.created_at, tz) }));
  const reactionDates = new Set(reactsWithLocalDate.map((r) => r.date));

  const foodsByDate: Record<string, string[]> = {};
  for (const f of foods.results as any[]) {
    const date = isoToLocalDateStr(f.created_at, tz);
    if (!foodsByDate[date]) foodsByDate[date] = [];
    foodsByDate[date].push(f.text);
  }

  const reactionCountByDate: Record<string, number> = {};
  for (const r of reactsWithLocalDate) {
    reactionCountByDate[r.date] = (reactionCountByDate[r.date] || 0) + 1;
  }

  const dailyCounts: Array<{ date: string; foods: number; reactions: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const dateStr = shiftDateStr(todayLocal, -i);
    dailyCounts.push({
      date: dateStr,
      foods: foodsByDate[dateStr]?.length || 0,
      reactions: reactionCountByDate[dateStr] || 0,
    });
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
    totalReactions: reactsWithLocalDate.length,
    reactions: reactsWithLocalDate,
    correlations: correlations.slice(0, 10),
    dailyCounts,
  });
};
