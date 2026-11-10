<script lang="ts">
  import { Gamepad2, Store as StoreIcon } from '@lucide/svelte';
  import type { Store } from '../lib/types';

  /** Show the saved SVG for a provider, with a neutral symbol when no image is usable. */
  let { store, svg }: { store: Store; svg?: string } = $props();
  let failed = $state<string>();
  const image = $derived(svg && `data:image/svg+xml,${encodeURIComponent(svg)}`);
</script>

{#if image && failed !== image}
  <img
    src={image}
    width="18"
    height="18"
    alt=""
    aria-hidden="true"
    onerror={() => (failed = image)}
  />
{:else if store === 'manual'}
  <Gamepad2 size={18} aria-hidden="true" />
{:else}
  <StoreIcon size={18} aria-hidden="true" />
{/if}

<style>
  img {
    object-fit: contain;
    flex-shrink: 0;
  }
</style>
