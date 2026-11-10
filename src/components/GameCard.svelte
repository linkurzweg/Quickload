<script lang="ts">
  import { Heart } from '@lucide/svelte';
  import type { ArtworkPosition, Game } from '../lib/types';
  import { translate, storeName, type Locale } from '../lib/i18n';
  import Artwork from './Artwork.svelte';
  let {
    game,
    locale,
    artwork,
    onselect,
    onfocus,
    revision = 0,
    position,
  }: {
    game: Game;
    locale: Locale;
    artwork: boolean;
    onselect: () => void;
    onfocus: () => void;
    revision?: number;
    position?: ArtworkPosition | null;
  } = $props();
  /** Translate English `message` using the locale supplied by the parent library. */
  function t(message: string) {
    return translate(locale, message);
  }
</script>

<button
  class="game-card"
  data-nav
  data-game={game.id}
  aria-label={game.title}
  onclick={onselect}
  {onfocus}
>
  <div class="cover">
    <Artwork {game} enabled={artwork} {revision} {position} layout="tile" />
    <div class="cover-shade"></div>
    {#if game.favorite}<span class="favorite-badge"><Heart size={12} fill="currentColor" /></span
      >{/if}
    <span class="store-tag">{storeName(game.store, locale).split(' · ')[0]}</span>
    <span
      class:unavailable={!game.installed}
      class="install-dot"
      title={game.installed ? t('Installed') : t('Not installed')}
    ></span>
  </div>
  <span class="card-title">{game.title}</span>
</button>
