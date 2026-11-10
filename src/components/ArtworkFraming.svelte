<script lang="ts">
  import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from '@lucide/svelte';
  import Artwork from './Artwork.svelte';
  import { translate, type Locale } from '../lib/i18n';
  import type { ArtworkPosition, ArtworkPositions, Game } from '../lib/types';

  let {
    game,
    locale,
    initial,
    enabled,
    saving,
    onsave,
  }: {
    game: Game;
    locale: Locale;
    initial?: ArtworkPositions;
    enabled: boolean;
    saving: boolean;
    onsave: (positions: ArtworkPositions) => void;
  } = $props();
  let kind = $state<keyof ArtworkPositions>('cover');
  let draft = $state<ArtworkPositions>({});
  const position = $derived(kind in draft ? draft[kind] : initial?.[kind]);
  const defaultPosition = $derived<ArtworkPosition>(kind === 'cover' ? [50, 50] : [50, 38]);

  /** Translate an editor control's English `message` into the current locale. */
  function t(message: string): string {
    return translate(locale, message);
  }

  /** Shift the current role's focus by `x` and `y` percentage points within the image. */
  function shift(x: number, y: number): void {
    const [left, top] = position ?? defaultPosition;
    draft[kind] = [Math.max(0, Math.min(100, left + x)), Math.max(0, Math.min(100, top + y))];
  }
</script>

<section class="framing-editor" aria-label={t('Artwork framing')}>
  <div class="framing-tools">
    <button
      data-nav
      class="secondary"
      aria-pressed={kind === 'cover'}
      onclick={() => (kind = 'cover')}>{t('Cover')}</button
    >
    <button
      data-nav
      class="secondary"
      aria-pressed={kind === 'hero'}
      onclick={() => (kind = 'hero')}>{t('Hero artwork')}</button
    >
  </div>
  <div class="framing-preview" class:cover={kind === 'cover'}>
    <Artwork {game} {kind} {enabled} {position} layout={kind === 'cover' ? 'tile' : undefined} />
  </div>
  <div class="framing-tools">
    <button
      data-nav
      class="icon-button bordered"
      aria-label={t('Move crop left')}
      onclick={() => shift(-10, 0)}><ArrowLeft size={16} /></button
    >
    <button
      data-nav
      class="icon-button bordered"
      aria-label={t('Move crop right')}
      onclick={() => shift(10, 0)}><ArrowRight size={16} /></button
    >
    <button
      data-nav
      class="icon-button bordered"
      aria-label={t('Move crop up')}
      onclick={() => shift(0, -10)}><ArrowUp size={16} /></button
    >
    <button
      data-nav
      class="icon-button bordered"
      aria-label={t('Move crop down')}
      onclick={() => shift(0, 10)}><ArrowDown size={16} /></button
    >
    <button data-nav class="secondary" onclick={() => (draft[kind] = null)}
      >{t('Reset framing')}</button
    >
    <button
      data-nav
      class="primary"
      disabled={saving}
      onclick={() => onsave({ ...$state.snapshot(initial), ...$state.snapshot(draft) })}
      >{t('Save framing')}</button
    >
  </div>
</section>

<style>
  .framing-editor {
    display: grid;
    gap: 12px;
    margin-top: 14px;
  }
  .framing-tools {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .framing-tools [aria-pressed='true'] {
    background: #ffffff24;
  }
  .framing-preview {
    width: min(100%, 420px);
    aspect-ratio: 3 / 1;
    overflow: hidden;
    border-radius: 12px;
  }
  .framing-preview:global(.cover) {
    aspect-ratio: 16 / 9;
  }
</style>
