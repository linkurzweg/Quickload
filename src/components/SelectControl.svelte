<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ChevronDown, Check } from '@lucide/svelte';
  let {
    id,
    label,
    hideLabel = false,
    value = $bindable(''),
    options,
  }: {
    id: string;
    label: string;
    hideLabel?: boolean;
    value?: string;
    options: { value: string; label: string }[];
  } = $props();
  let open = $state(false);
  let host: HTMLDivElement;
  let trigger: HTMLButtonElement;

  /** Open the list and focus its selected option after rendering; closing restores trigger focus. */
  async function toggle() {
    if (open) {
      close();
      return;
    }
    open = true;
    await tick();
    host.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }

  /** Close the list without changing the selection; return focus to the combobox trigger. */
  function close() {
    open = false;
    trigger.focus({ preventScroll: true });
  }

  /** Commit option `next` and return focus to the trigger without submitting surrounding forms. */
  function choose(next: string) {
    value = next;
    close();
  }

  /** Handle keyboard `event` inside the control; prevent application navigation from taking these keys. */
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (!open) {
        void toggle();
        return;
      }
      const items = [...host.querySelectorAll<HTMLButtonElement>('[role="option"]')];
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : Math.max(
                0,
                Math.min(items.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)),
              );
      items[next]?.focus();
    } else if (event.key === 'Tab') open = false;
  }

  onMount(() => {
    /** Close an open list when pointer `event` targets another control, preserving its new focus. */
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !host.contains(event.target)) open = false;
    }
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  });
</script>

<div class="select-control" bind:this={host}>
  {#if !hideLabel}<label for={id}>{label}</label>{/if}
  <button
    {id}
    type="button"
    class="select-trigger"
    role="combobox"
    data-nav
    aria-label={label}
    aria-expanded={open}
    aria-haspopup="listbox"
    aria-controls={`${id}-options`}
    onclick={toggle}
    onkeydown={keydown}
    bind:this={trigger}
  >
    <span>{options.find((option) => option.value === value)?.label ?? options[0]?.label}</span>
    <ChevronDown size={16} aria-hidden="true" />
  </button>
  {#if open}
    <div
      class="select-options"
      id={`${id}-options`}
      role="listbox"
      aria-label={label}
      data-select-list
    >
      {#each options as option (option.value)}
        <button
          type="button"
          role="option"
          data-nav
          aria-selected={value === option.value}
          onclick={() => choose(option.value)}
          onkeydown={keydown}
        >
          <span>{option.label}</span>{#if value === option.value}<Check
              size={16}
              aria-hidden="true"
            />{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
