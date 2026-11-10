<script lang="ts">
  import { resolveArtwork } from '../lib/artwork';
  import type { Game } from '../lib/types';

  let { game }: { game: Game } = $props();
  let url = $state('');
  let loaded = $state(false);
  $effect(() => {
    let cancelled = false;
    url = '';
    loaded = false;
    void resolveArtwork(game, 'logo').then((image) => {
      if (!cancelled) url = image?.url ?? '';
    });
    return () => {
      cancelled = true;
    };
  });
</script>

{#if url}
  <img
    class="game-logo"
    class:logo-loaded={loaded}
    src={url}
    alt=""
    aria-hidden="true"
    decoding="async"
    onload={() => (loaded = true)}
    onerror={() => (url = '')}
  />
{/if}
