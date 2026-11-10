import { describe, it, expect } from 'vite-plus/test';
import { resolveLocale, translate, storeName } from '../src/lib/i18n';
import { isFullscreenShortcut, fullscreenKeys } from '../src/lib/platform';

describe('language preferences', () => {
  it('follows supported system languages with an explicit override and English fallback', () => {
    expect(resolveLocale('system', ['de-AT', 'en-US'])).toBe('de');
    expect(resolveLocale('system', ['fr-FR', 'en-GB'])).toBe('en');
    expect(resolveLocale('system', ['ja-JP'])).toBe('en');
    expect(resolveLocale('en', ['de-DE'])).toBe('en');
    expect(resolveLocale('de', ['en-US'])).toBe('de');
  });
  it('translates messages, parameters and manual-store labels without HTML interpolation', () => {
    expect(translate('de', 'View all {count} games', { count: 90 })).toBe('Alle 90 Spiele ansehen');
    expect(translate('en', 'View all {count} games', { count: 90 })).toBe('View all 90 games');
    expect(translate('de', 'Unknown system error')).toBe('Unknown system error');
    expect(translate('en', 'Connected: {name}', { name: '<img>' })).toBe('Connected: <img>');
    expect(storeName('manual', 'en')).toBe('Your own games');
    expect(storeName('manual', 'de')).toBe('Eigene Spiele');
  });
});

describe('platform fullscreen shortcuts', () => {
  it('accepts conventional shortcuts and rejects repeats or extra modifiers', () => {
    const event = (key: string, rest: Partial<KeyboardEvent> = {}) =>
      ({
        key,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        repeat: false,
        ...rest,
      }) as KeyboardEvent;
    expect(isFullscreenShortcut(event('Enter', { altKey: true }), 'Win32')).toBe(true);
    expect(isFullscreenShortcut(event('F11'), 'Linux x86_64')).toBe(true);
    expect(isFullscreenShortcut(event('f', { ctrlKey: true, metaKey: true }), 'MacIntel')).toBe(
      true,
    );
    expect(isFullscreenShortcut(event('f', { ctrlKey: true }), 'MacIntel')).toBe(false);
    expect(isFullscreenShortcut(event('Enter', { altKey: true, repeat: true }), 'Win32')).toBe(
      false,
    );
    expect(isFullscreenShortcut(event('Enter', { altKey: true, shiftKey: true }), 'Win32')).toBe(
      false,
    );
    expect(fullscreenKeys('MacIntel')).toBe('⌃⌘F');
    expect(fullscreenKeys('Win32')).toBe('Alt+Enter');
  });
});
