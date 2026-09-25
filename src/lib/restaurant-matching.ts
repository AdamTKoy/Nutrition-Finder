// Accept matching names after normalizing capitalization and punctuation,
// plus explicitly listed aliases (ex: McDonalds and McDonald's recognized as same if Spoonacular and Google differ)

function normalizeName(name: string): string {
  return name
    .normalize("NFKD")  // Normalization Form Compatibility Decomposition
    .replace(/[\u0300-\u036f]/g, "")    // remove diacritical marks (accents, tildes, umlauts, etc.)
    .toLowerCase()
    .replace(/['’]/g, "")   // remove single quotes/apostrophes (curly and straight)
    .replace(/&/g, " and ") // replace ampersands with the word 'and'
    .replace(/[^a-z0-9]+/g, " ")    // replace any non-alphanumeric characters with single space
    .trim();
}

// Add aliases deliberately as you inspect real results.
const aliasGroups: string[][] = [
  ["Chipotle", "Chipotle Mexican Grill"],
  ["KFC", "Kentucky Fried Chicken"],
];

export function matchesRestaurantChain(
  chain: string,
  placeName: string,
): boolean {
  const expected = normalizeName(chain);
  const actual = normalizeName(placeName);

  if (!expected || !actual) return false;
  if (expected === actual) return true;

  return aliasGroups.some((group) => {
    const names = group.map(normalizeName);
    return names.includes(expected) && names.includes(actual);
  });
}