import { describe, it, expect } from 'vitest';
import { fuzzyMatch, tokenMatches, normalize, levenshtein } from './allergenMatch';

describe('normalize', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalize('Corn  Masa')).toBe('corn masa');
  });

  it('replaces punctuation with a space instead of deleting it', () => {
    // Regression: deleting punctuation merged adjacent words into one token
    // (e.g. "garlic)" + "onion" -> "garliconion"), which broke exact matching
    // and could cause bogus substring matches.
    expect(normalize('Corn Masa(100%), Water/Lard, Garlic,Onion')).toBe(
      'corn masa 100 water lard garlic onion'
    );
  });
});

describe('tokenMatches', () => {
  it('matches identical tokens', () => {
    expect(tokenMatches('garlic', 'garlic')).toBe(true);
  });

  it('matches an allergen as a compound-word substring of an ingredient', () => {
    expect(tokenMatches('soy', 'soybean')).toBe(true);
    expect(tokenMatches('milk', 'buttermilk')).toBe(true);
  });

  it('does not match the reverse direction (ingredient contained in allergen)', () => {
    // A short, unrelated ingredient token should not "match" just because it
    // happens to be a substring of the allergen word.
    expect(tokenMatches('garlic', 'gar')).toBe(false);
    expect(tokenMatches('garlic', 'arli')).toBe(false);
  });

  it('does not fuzzy-match unrelated words of similar length', () => {
    expect(tokenMatches('garlic', 'grande')).toBe(false);
    expect(tokenMatches('garlic', 'gravy')).toBe(false);
  });

  it('catches a single-letter misspelling of a longer allergen', () => {
    expect(tokenMatches('garlic', 'garljc')).toBe(true); // 1 substitution
  });

  it('catches a 2-edit misspelling only for longer (6+ char) tokens', () => {
    expect(tokenMatches('peanut', 'peanit')).toBe(true); // 1 edit
    expect(tokenMatches('peanut', 'peandt')).toBe(true); // 1 edit, different position
  });

  it('requires closer matches for short (4-5 char) tokens', () => {
    // "milk" (4 chars) allows only 1 edit, not 2
    expect(tokenMatches('milk', 'mild')).toBe(true); // 1 edit
    expect(tokenMatches('milk', 'mold')).toBe(false); // 2 edits, too loose for a 4-char word
  });

  it('ignores tokens shorter than 4 characters entirely', () => {
    expect(tokenMatches('soy', 'toy')).toBe(false);
  });
});

describe('fuzzyMatch', () => {
  it('finds an allergen that is actually in the ingredients', () => {
    expect(fuzzyMatch('Corn Masa, Lard, Salt, Garlic Powder', 'garlic')).toBe(true);
  });

  it('does not flag an allergen absent from the ingredients', () => {
    // Regression: tamale-style ingredients with no garlic should not trigger
    // a "garlic" warning.
    const ingredients = 'Corn Masa, Water, Lard, Salt, Chili Powder, Cumin, Baking Powder';
    expect(fuzzyMatch(ingredients, 'garlic')).toBe(false);
  });

  it('requires every word of a multi-word allergen to be present', () => {
    // "peanut butter" should not match ingredients that only contain "butter"
    expect(fuzzyMatch('Corn Masa, Butter, Salt', 'peanut butter')).toBe(false);
    expect(fuzzyMatch('Corn Masa, Peanut Butter, Salt', 'peanut butter')).toBe(true);
  });

  it('catches a compound-word allergen like soy in soybean oil', () => {
    expect(fuzzyMatch('Water, Soybean Oil, Salt', 'soy')).toBe(true);
  });

  it('catches a misspelled allergen in the ingredients text', () => {
    expect(fuzzyMatch('Corn Masa, Garljc Powder, Salt', 'garlic')).toBe(true);
  });

  it('handles ingredients with no separating space around punctuation', () => {
    expect(fuzzyMatch('Corn Masa(100%),Garlic Powder,Salt', 'garlic')).toBe(true);
    expect(fuzzyMatch('Corn Masa(100%),Onion Powder,Salt', 'garlic')).toBe(false);
  });

  it('returns false for empty ingredients or empty allergen', () => {
    expect(fuzzyMatch('', 'garlic')).toBe(false);
    expect(fuzzyMatch('Corn, Salt', '')).toBe(false);
  });
});

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('garlic', 'garlic')).toBe(0);
  });

  it('counts a single substitution', () => {
    expect(levenshtein('garlic', 'garljc')).toBe(1);
  });

  it('counts insertions and deletions', () => {
    expect(levenshtein('cat', 'cats')).toBe(1);
    expect(levenshtein('cats', 'cat')).toBe(1);
  });
});
