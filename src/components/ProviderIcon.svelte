<script lang="ts">
  /** Display the saved provider SVG when the WebView can load it. */
  let { svg }: { svg?: string } = $props();
  let failed = $state<string>();
  const image = $derived(svg && `data:image/svg+xml,${encodeURIComponent(svg)}`);
</script>

{#if image && failed !== image}
  <span class="icon" style:mask-image={`url("${image}")`} aria-hidden="true">
    <img src={image} width="18" height="18" alt="" onerror={() => (failed = image)} />
  </span>
{/if}

<style>
  .icon {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    background: currentColor;
    mask-position: center;
    mask-repeat: no-repeat;
    mask-size: contain;
    forced-color-adjust: none;
  }

  img {
    opacity: 0;
  }
</style>
