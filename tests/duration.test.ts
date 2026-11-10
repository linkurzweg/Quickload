import { describe, it, expect } from 'vite-plus/test';
import { formatDuration } from '../src/lib/duration';

describe('scan duration', () => {
  it('selects readable units at display boundaries and localizes decimals', () => {
    expect(formatDuration(0, 'en')).toBe('0 ms');
    expect(formatDuration(999, 'en')).toBe('999 ms');
    expect(formatDuration(1000, 'en')).toBe('1 s');
    expect(formatDuration(2851, 'de')).toBe('2,9 s');
    expect(formatDuration(59_949, 'en')).toBe('59.9 s');
    expect(formatDuration(59_950, 'en')).toBe('1 min');
    expect(formatDuration(90_000, 'en')).toBe('1.5 min');
    expect(formatDuration(120_000, 'de')).toBe('2 min');
  });
  it('handles invalid duration values without exposing NaN or negative time', () => {
    expect(formatDuration(-1, 'de')).toBe('0 ms');
    expect(formatDuration(NaN, 'en')).toBe('0 ms');
    expect(formatDuration(Infinity, 'en')).toBe('0 ms');
  });
});
