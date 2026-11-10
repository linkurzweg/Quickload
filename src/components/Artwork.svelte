<script module lang="ts">
  /** Retain one decoded hero identity across page unmounts without growing a second artwork cache. */
  let lastHero: { key: string; url: string; source: string; fit: 'contain' | 'cover' } | undefined;
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import {
    artworkCandidates,
    tileImageFit,
    observeArtwork,
    resolveArtwork,
    resolveLocalCover,
    type ArtworkImage,
    type ArtworkKind,
  } from '../lib/artwork';
  import { native } from '../lib/api';
  import GameLogo from './GameLogo.svelte';
  import type { ArtworkPosition, Game } from '../lib/types';

  let {
    game,
    kind = 'cover',
    enabled = true,
    eager = false,
    revision = 0,
    position,
    layout,
  }: {
    game: Game;
    kind?: ArtworkKind;
    enabled?: boolean;
    eager?: boolean;
    revision?: number;
    position?: ArtworkPosition | null;
    layout?: 'tile' | 'detail';
  } = $props();
  let host = $state<HTMLDivElement>();
  const initialHero = untrack(() =>
    enabled && kind === 'hero' && lastHero?.key === `${game.id}:${game.title}:${revision}`
      ? lastHero
      : undefined,
  );
  let visible = $state(untrack(() => eager));
  let url = $state(initialHero?.url ?? '');
  let previousUrl = $state('');
  let source = $state(initialHero?.source ?? '');
  let loaded = $state(!!initialHero);
  let previousSource = $state('');
  let fit = $state<'contain' | 'cover'>(initialHero?.fit ?? 'cover');
  let previousFit = $state<'contain' | 'cover'>('cover');
  let candidate = $state(0);
  let shownGame = '';
  let tileFit = $state<'fill' | 'cover'>('cover');
  let previousTileFit = $state<'fill' | 'cover'>('cover');
  const candidates = $derived(artworkCandidates(game, layout === 'detail' ? 'detail' : kind));

  $effect(() => {
    if (!host || eager) {
      visible = eager;
      return;
    }
    return observeArtwork(host, () => (visible = true));
  });
  $effect(() => {
    const current = game;
    const format = layout === 'detail' ? 'detail' : kind;
    const surface = layout;
    void revision;
    candidate = 0;
    if (!enabled || !visible) {
      url = '';
      previousUrl = '';
      loaded = false;
      return;
    }
    let cancelled = false;
    /** Present `image` while retaining the current layer until the new one has loaded. */
    function present(image: ArtworkImage | null) {
      if (cancelled) return;
      if (!image) {
        if (shownGame !== current.id) {
          url = '';
          previousUrl = '';
          loaded = false;
        }
        return;
      }
      shownGame = current.id;
      if (image.url === url) return;
      if (loaded) {
        previousUrl = url;
        previousFit = fit;
        previousSource = source;
        previousTileFit = tileFit;
      }
      fit = image.fit ?? 'cover';
      loaded = false;
      url = image.url;
      source = image.source;
    }
    void (async () => {
      if ((format === 'cover' || surface === 'detail') && native) {
        const local = await resolveLocalCover(current);
        if (cancelled) return;
        present(local);
        if (local && !local.needsUpgrade && format === 'cover') return;
      }
      present(await resolveArtwork(current, format));
    })();
    return () => {
      cancelled = true;
    };
  });

  /** Try the next explicit preview CDN variant after a decode/HTTP failure; native lookup already retries. */
  function failed() {
    if (native && previousUrl) {
      url = previousUrl;
      previousUrl = '';
      fit = previousFit;
      source = previousSource;
      tileFit = previousTileFit;
      loaded = true;
      return;
    }
    loaded = false;
    candidate++;
    url = !native ? (candidates[candidate] ?? '') : '';
    if (!url) previousUrl = '';
  }

  /** Reveal the decoded image and release its previous cover immediately in reduced-motion mode. */
  function imageLoaded(event: Event): void {
    const image = event.currentTarget as HTMLImageElement;
    tileFit = tileImageFit(image.naturalWidth, image.naturalHeight);
    loaded = true;
    if (kind === 'hero')
      lastHero = { key: `${game.id}:${game.title}:${revision}`, url, source, fit };
    if (
      kind === 'cover' &&
      (host?.closest('.reduced-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches)
    ) {
      previousUrl = '';
    }
  }

  $effect(() => {
    if (!loaded || !previousUrl) return;
    const timer = setTimeout(() => (previousUrl = ''), kind === 'hero' ? 280 : 360);
    return () => clearTimeout(timer);
  });
</script>

<div
  class="artwork"
  style:--artwork-position={position ? `${position[0]}% ${position[1]}%` : undefined}
  class:artwork-loaded={loaded}
  class:artwork-hero={kind === 'hero'}
  class:artwork-crop={layout === 'tile' && !!position}
  class:artwork-tile={layout === 'tile'}
  class:artwork-banner={layout === 'detail'}
  bind:this={host}
>
  <img class="artwork-placeholder" src="/artwork/placeholder.svg" alt="" aria-hidden="true" />
  {#if previousUrl}<img
      class="artwork-previous"
      style:object-fit={layout === 'tile' && !position ? previousTileFit : undefined}
      class:artwork-contained={kind === 'hero' && previousFit === 'contain'}
      src={previousUrl}
      alt=""
      aria-hidden="true"
    />{/if}
  {#if url}<img
      class="artwork-image"
      style:object-fit={layout === 'tile' && !position ? tileFit : undefined}
      class:artwork-contained={kind === 'hero' &&
        (fit === 'contain' || (candidate > 0 && !url.includes('library_hero')))}
      src={url}
      alt=""
      title={source}
      decoding="async"
      loading={eager ? 'eager' : 'lazy'}
      fetchpriority={eager ? 'high' : 'auto'}
      onload={imageLoaded}
      onerror={failed}
    />{/if}
  {#if layout === 'detail' && url && (native ? fit === 'cover' : url.includes('library_hero'))}
    <GameLogo {game} />
  {/if}
</div>
