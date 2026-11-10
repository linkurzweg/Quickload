/** Normalize a title or query for case-, accent- and punctuation-independent comparison. */
export function searchKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Precomputed title and word keys for a single keyboard session. */
export interface SuggestionEntry {
  title: string;
  key: string;
  words: string[];
}

/** Build a deduplicated local index from `titles`, retaining display spelling. */
export function indexSuggestions(titles: readonly string[]): SuggestionEntry[] {
  return [...new Set(titles)].map((title) => {
    const key = searchKey(title);
    return { title, key, words: key.split(' ') };
  });
}

/** Check whether query `word` matches the start of `candidate` with one edit or transposition.
 * Check at most the query length plus one code unit, and require exact numbers.
 */
function nearPrefix(word: string, candidate: string): boolean {
  if (
    word.length < 3 ||
    Math.abs(Math.min(candidate.length, word.length + 1) - word.length) > 1 ||
    /\d/.test(word)
  )
    return false;
  let i = 0;
  while (i < word.length && word[i] === candidate[i]) i++;
  if (i === word.length) return true;
  const rest = word.slice(i + 1);
  return (
    candidate.startsWith(rest, i + 1) ||
    candidate.startsWith(word.slice(i), i + 1) ||
    candidate.startsWith(rest, i) ||
    (i + 1 < word.length &&
      word[i] === candidate[i + 1] &&
      word[i + 1] === candidate[i] &&
      candidate.startsWith(word.slice(i + 2), i + 2))
  );
}

/** Return up to five matches from `index` for `query`, ordered by exactness.
 * The shortlist stays fixed in size and only nonempty, bounded queries scan the index.
 */
export function suggestTitles(index: readonly SuggestionEntry[], query: string): string[] {
  const key = searchKey(query.slice(0, 160));
  if (!key) return [];
  const words = key.split(' ');
  const best: { title: string; score: number }[] = [];
  for (const entry of index) {
    let score =
      entry.key === key ? 0 : entry.key.startsWith(key) ? 1 : entry.key.includes(key) ? 2 : 3;
    if (score === 3) {
      let exact = true;
      for (const word of words) {
        if (entry.words.some((candidate) => candidate.startsWith(word))) continue;
        if (!entry.words.some((candidate) => nearPrefix(word, candidate))) {
          score = Infinity;
          break;
        }
        exact = false;
      }
      if (score === 3 && !exact) score = 4;
    }
    if (!Number.isFinite(score) || (best.length === 5 && best[4].score <= score)) continue;
    const position = best.findIndex((match) => match.score > score);
    best.splice(position < 0 ? best.length : position, 0, { title: entry.title, score });
    if (best.length > 5) best.pop();
  }
  return best.map(({ title }) => title);
}
