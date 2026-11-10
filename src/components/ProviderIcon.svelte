<script lang="ts">
  /** Display the saved provider SVG when the WebView can load it. */
  let { svg }: { svg?: string } = $props();
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
{/if}

<style>
  img {
    object-fit: contain;
    flex-shrink: 0;
  }
</style>
