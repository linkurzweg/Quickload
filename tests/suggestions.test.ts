import { expect, test } from 'vite-plus/test';
import { indexSuggestions, suggestTitles } from '../src/lib/suggestions';

test('title suggestions rank exact matches and tolerate accents, partial words and transpositions', () => {
  const index = indexSuggestions([
    'Elden Ring Nightreign',
    'ELDEN RING',
    'Pokémon Violet',
    'Tekken 7',
    'Tekken 8',
    'ELDEN RING',
  ]);
  expect(suggestTitles(index, 'elden ring')).toEqual(['ELDEN RING', 'Elden Ring Nightreign']);
  expect(suggestTitles(index, 'edlen rin')).toEqual(['Elden Ring Nightreign', 'ELDEN RING']);
  expect(suggestTitles(index, 'pokemon vio')).toEqual(['Pokémon Violet']);
  expect(suggestTitles(index, 'tekken 8')).toEqual(['Tekken 8']);
  expect(suggestTitles(index, '  ')).toEqual([]);
});

test('a large library returns a bounded shortlist and promotes a late exact match', () => {
  const titles = Array.from({ length: 10000 }, (_, i) => `Arcade ${i}`);
  const index = indexSuggestions([...titles, 'Arcade']);
  expect(suggestTitles(index, 'arcade')).toEqual(['Arcade', ...titles.slice(0, 4)]);
});
