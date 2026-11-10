<script lang="ts">
  import type { GlyphFamily } from '../lib/controller';
  let { button = 'a', family = 'xbox' }: { button?: string; family?: GlyphFamily } = $props();
  const xbox: Record<string, string> = {
    a: 'A',
    b: 'B',
    x: 'X',
    y: 'Y',
    lb: 'LB',
    rb: 'RB',
    lt: 'LT',
    rt: 'RT',
    view: 'View',
    menu: 'Menu',
  };
  const ps: Record<string, string> = {
    a: '×',
    b: '○',
    x: '□',
    y: '△',
    lb: 'L1',
    rb: 'R1',
    lt: 'L2',
    rt: 'R2',
    view: 'Create',
    menu: 'Options',
  };
  const nintendo: Record<string, string> = {
    a: 'A',
    b: 'B',
    x: 'X',
    y: 'Y',
    lb: 'L',
    rb: 'R',
    lt: 'ZL',
    rt: 'ZR',
    view: '−',
    menu: '+',
  };
  const shoulder = $derived(['lb', 'rb', 'lt', 'rt'].includes(button));
  const system = $derived(button === 'view' || button === 'menu');
  const label = $derived(
    (family === 'playstation' ? ps : family === 'nintendo' ? nintendo : xbox)[button] ?? button,
  );
</script>

<span class="glyph {family} {button}" class:shoulder aria-hidden="true" data-symbol={label}>
  <svg
    viewBox={shoulder ? '0 0 36 24' : '0 0 24 24'}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {#if system}
      <g stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        {#if family === 'nintendo'}
          <circle cx="12" cy="12" r="10" fill="currentColor" fill-opacity=".06" />
          <path d="M7 12h10" />{#if button === 'menu'}<path d="M12 7v10" />{/if}
        {:else if family === 'playstation'}
          {#if button === 'menu'}<path d="M5 6h14M5 12h14M5 18h14" stroke-width="2" />
          {:else}<path d="M12 3v9M4 7l4 7M20 7l-4 7" stroke-width="2" />{/if}
        {:else}
          <circle cx="12" cy="12" r="10.5" fill="currentColor" fill-opacity=".06" />
          {#if button === 'menu'}<path d="M7 8h10M7 12h10M7 16h10" />
          {:else}<rect x="6" y="7" width="8" height="7" rx=".5" /><path d="M10 15v2h8v-7h-3" />{/if}
        {/if}
      </g>
    {:else if shoulder}
      <rect
        x="1"
        y="3"
        width="34"
        height="19"
        rx="5"
        fill="currentColor"
        fill-opacity=".08"
        stroke="currentColor"
        stroke-width="1.5"
      />
      <text
        x="18"
        y="16.5"
        text-anchor="middle"
        fill="currentColor"
        font-size="10"
        font-weight="650">{label}</text
      >
    {:else}
      <circle
        cx="12"
        cy="12"
        r="10.5"
        fill="currentColor"
        fill-opacity=".06"
        stroke="currentColor"
        stroke-width="1.4"
      />
      {#if family === 'playstation'}
        <g stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          {#if button === 'a'}<path d="m8 8 8 8m0-8-8 8" />
          {:else if button === 'b'}<circle cx="12" cy="12" r="5" />
          {:else if button === 'x'}<rect x="7.5" y="7.5" width="9" height="9" rx=".6" />
          {:else if button === 'y'}<path d="m12 6 6 11H6z" />{/if}
        </g>
      {:else}<text
          x="12"
          y="16.3"
          text-anchor="middle"
          fill="currentColor"
          font-size="12"
          font-weight="650">{label}</text
        >{/if}
    {/if}
  </svg>
</span>
