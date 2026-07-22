import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '');
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function fuzzyMatch(ingredientsText: string, allergen: string): boolean {
  const normalizedIngredients = normalize(ingredientsText);
  const normalizedAllergen = normalize(allergen);
  const ingredientTokens = normalizedIngredients.split(/\s+/).filter(Boolean);
  const allergenTokens = normalizedAllergen.split(/\s+/).filter(Boolean);

  return allergenTokens.some(aToken =>
    ingredientTokens.some(iToken =>
      iToken.includes(aToken) || aToken.includes(iToken) ||
      (aToken.length >= 4 && iToken.length >= 4 && levenshtein(aToken, iToken) <= 2)
    )
  );
}

export const GET: RequestHandler = async ({ url, platform, cookies }) => {
  const barcode = url.searchParams.get('barcode');

  if (!barcode) return json({ error: 'barcode required' }, { status: 400 });

  // Look up user allergens if session exists
  let userAllergens: string[] = [];
  const session = cookies.get('ft_session');
  if (session) {
    const [userIdStr, token] = session.split(':');
    if (userIdStr && token && platform?.env?.FTD1) {
      try {
        const row = await platform.env.FTD1.prepare(
          "SELECT u.id FROM users u JOIN sessions s ON u.id = s.user_id WHERE s.user_id = ? AND s.token = ? AND s.expires_at > datetime('now') LIMIT 1"
        ).bind(parseInt(userIdStr), token).first();
        if (row) {
          const { results } = await platform.env.FTD1.prepare(
            'SELECT ingredient FROM user_allergens WHERE user_id = ?'
          ).bind(row.id).all();
          userAllergens = results.map((r: any) => r.ingredient.toLowerCase());
        }
      } catch {
        // ignore — allergen check is best-effort
      }
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let res: Response;
    try {
      res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`, {
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      return json({ found: false, error: `Upstream API error (${res.status})` }, { status: 502 });
    }

    const data = await res.json();

    if (data.status !== 1 || !data.product) {
      return json({ found: false });
    }

    const p = data.product;
    const ingredientsText = (p.ingredients_text || '').toLowerCase();

    // Check allergen warnings
    const warnings: string[] = [];
    if (userAllergens.length > 0 && ingredientsText) {
      for (const allergen of userAllergens) {
        if (fuzzyMatch(ingredientsText, allergen)) {
          warnings.push(allergen);
        }
      }
    }

    return json({
      found: true,
      name: p.product_name || 'Unknown product',
      brand: p.brands || '',
      ingredients: p.ingredients_text || '',
      allergens: p.allergens_tags?.map((a: string) => a.replace('en:', '')) || [],
      image: p.image_url || '',
      barcode,
      warnings,
    });
  } catch (e: any) {
    const msg = e?.name === 'AbortError'
      ? 'Product lookup timed out'
      : `Failed to fetch: ${e?.message || e}`;
    return json({ found: false, error: msg }, { status: 500 });
  }
};
