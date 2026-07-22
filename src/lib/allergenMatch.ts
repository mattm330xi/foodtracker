/**
 * Detects whether a user's allergen appears in a scanned product's ingredients text.
 * Tuned to avoid the two failure modes of naive substring/fuzzy matching:
 * an allergen must actually be present (every word of a multi-word allergen),
 * and near-matches are only allowed when they plausibly represent a misspelling
 * or run-on punctuation, not an unrelated word that happens to overlap.
 */

export function normalize(text: string): string {
  // Replace (not strip) punctuation with a space so tokens don't accidentally
  // merge across a missing space, e.g. "garlic)" or "garlic," or "corn/masa".
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function levenshtein(a: string, b: string): number {
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

export function tokenMatches(aToken: string, iToken: string): boolean {
  if (aToken === iToken) return true;

  // Compound-word containment (e.g. allergen "soy" inside ingredient "soybean",
  // allergen "milk" inside "buttermilk"). Only in this direction, and only for
  // allergen tokens long enough that a coincidental match is unlikely.
  if (aToken.length >= 3 && iToken.includes(aToken)) return true;

  // Misspellings: allow a small edit distance, but only between tokens of
  // near-identical length (differ by at most one character) so that trimming
  // a couple of letters off either end of a longer word can't pass as a
  // "misspelling" of an unrelated shorter one.
  if (aToken.length < 4 || iToken.length < 4) return false;
  if (Math.abs(aToken.length - iToken.length) > 1) return false;
  const maxDistance = aToken.length <= 5 ? 1 : 2;
  return levenshtein(aToken, iToken) <= maxDistance;
}

export function fuzzyMatch(ingredientsText: string, allergen: string): boolean {
  const normalizedIngredients = normalize(ingredientsText);
  const normalizedAllergen = normalize(allergen);
  const ingredientTokens = normalizedIngredients.split(/\s+/).filter(Boolean);
  const allergenTokens = normalizedAllergen.split(/\s+/).filter(Boolean);
  if (allergenTokens.length === 0) return false;

  // Every word of a multi-word allergen (e.g. "peanut butter") must appear
  // somewhere in the ingredients — not just one of the words.
  return allergenTokens.every(aToken =>
    ingredientTokens.some(iToken => tokenMatches(aToken, iToken))
  );
}
