<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { ArrowBigUp, Delete, Keyboard, X } from '@lucide/svelte';
  import Glyph from './Glyph.svelte';
  import { translate, type Locale } from '../lib/i18n';
  import type { GlyphFamily } from '../lib/controller';
  import { indexSuggestions, suggestTitles } from '../lib/suggestions';

  let {
    target,
    locale,
    family,
    reducedMotion,
    titles,
    onfinish,
  }: {
    target: HTMLInputElement | HTMLTextAreaElement;
    locale: Locale;
    family: GlyphFamily;
    reducedMotion: boolean;
    titles: readonly string[];
    onfinish: (value?: string, matches?: readonly string[]) => void;
  } = $props();
  let value = $state('');
  let editor: HTMLTextAreaElement;
  let first = $state<HTMLButtonElement>();
  let shifted = $state(false);
  let symbols = $state(false);
  let suggestions = $state<string[]>([]);
  const multiline = $derived(target instanceof HTMLTextAreaElement);
  const index = $derived(indexSuggestions(titles));
  const label = $derived(
    target.getAttribute('aria-label') ||
      target.labels?.[0]?.textContent?.trim() ||
      t('On-screen keyboard'),
  );
  const rows = $derived(
    symbols
      ? ['1234567890', '!@#$%&*()_', '-+=[]{};:,?', '/\\|~^`\'"<>€']
      : locale === 'de'
        ? ['1234567890', 'qwertzuiop', 'asdfghjklö', 'yxcvbnmäüß']
        : ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'],
  );

  /** Translate a keyboard control's English `message` into the active UI locale. */
  function t(message: string): string {
    return translate(locale, message);
  }

  /** Return the transition duration, honoring both the app setting and the system preference. */
  function motionDuration(): number {
    return reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160;
  }

  /** Fade the dimmer `node` without applying a full-screen blur. */
  function dimmerMotion(node: HTMLElement) {
    return fade(node, { duration: motionDuration() });
  }

  /** Move the panel `node` a few pixels as its opacity changes. */
  function panelMotion(node: HTMLElement) {
    return fly(node, { y: 8, duration: motionDuration(), easing: cubicOut });
  }

  /** Remove the outgoing dialog from input and focus scopes before its animation completes. */
  function deactivate(event: Event): void {
    const dialog = event.currentTarget as HTMLDialogElement;
    dialog.inert = true;
    dialog.parentElement?.setAttribute('inert', '');
  }

  onMount(async () => {
    value = target.value;
    await tick();
    editor.setSelectionRange(value.length, value.length);
    first?.focus({ preventScroll: true });
  });

  $effect(() => {
    const query = value;
    const entries = index;
    if (!query.trim() || !entries.length) {
      suggestions = [];
      return;
    }
    const timer = setTimeout(() => {
      const next = suggestTitles(entries, query);
      if (
        document.activeElement?.matches('[data-title-suggestion]') &&
        !next.includes((document.activeElement as HTMLElement).dataset.titleSuggestion ?? '')
      ) {
        first?.focus({ preventScroll: true });
      }
      suggestions = next;
    }, 45);
    return () => clearTimeout(timer);
  });

  /** Insert `text` at the editor selection, or delete the selected text or preceding code point. */
  function edit(text: string, erase = false): void {
    const { selectionStart, selectionEnd } = editor;
    const previous = value.charCodeAt(selectionStart - 1);
    const step = previous >= 0xdc00 && previous <= 0xdfff ? 2 : 1;
    const start =
      erase && selectionStart === selectionEnd
        ? Math.max(0, selectionStart - step)
        : selectionStart;
    const max = target.maxLength;
    if (max >= 0 && value.length - (selectionEnd - start) + text.length > max) return;
    editor.setRangeText(text, start, selectionEnd, 'end');
    value = editor.value;
  }

  /** Insert the visible `key` and release one-shot shift after a letter. */
  function enterKey(key: string): void {
    edit(key);
    if (!symbols && shifted && /\p{L}/u.test(key)) shifted = false;
  }

  /** Commit the draft, flattening pasted line breaks for single-line fields. */
  function commit(): void {
    const text = multiline ? value : value.replace(/[\r\n]/g, ' ');
    onfinish(text, index.length ? suggestTitles(index, text) : []);
  }

  /** Use `event` to submit from the physical editor without interfering with IME composition. */
  function editorKey(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.isComposing || (multiline && !event.ctrlKey)) return;
    event.preventDefault();
    commit();
  }

  /** Consume keyboard-specific controller `action` shortcuts while this modal owns input. */
  export function controllerShortcut(action: string): void {
    if (action === 'favorite') edit('', true);
    if (action === 'search') edit(' ');
    if (action === 'shift') shifted = !shifted;
    if (action === 'submit-text') commit();
    if (action === 'previous' || action === 'next') {
      const left = action === 'previous';
      const position = left ? editor.selectionStart : editor.selectionEnd;
      const unit = value.charCodeAt(left ? position - 1 : position);
      const surrogate = left ? unit >= 0xdc00 && unit <= 0xdfff : unit >= 0xd800 && unit <= 0xdbff;
      const next = Math.max(
        0,
        Math.min(value.length, position + (left ? -1 : 1) * (surrogate ? 2 : 1)),
      );
      editor.setSelectionRange(next, next);
    }
  }
</script>

<div class="modal-backdrop keyboard-backdrop" transition:dimmerMotion|global>
  <dialog
    open
    data-modal
    aria-modal="true"
    aria-labelledby="screen-keyboard-title"
    class="screen-keyboard"
    transition:panelMotion|global
    onoutrostart={deactivate}
  >
    <div class="keyboard-heading">
      <Keyboard size={19} aria-hidden="true" />
      <h2 id="screen-keyboard-title">{label}</h2>
      <button
        type="button"
        data-nav
        class="keyboard-clear"
        disabled={!value}
        onclick={() => {
          value = '';
          suggestions = [];
          first?.focus({ preventScroll: true });
        }}>{t('Clear input')}</button
      >
      <button
        type="button"
        data-nav
        class="icon-button"
        aria-label={t('Close')}
        onclick={() => onfinish()}><X size={19} /></button
      >
    </div>
    <textarea
      data-nav
      bind:this={editor}
      bind:value
      rows={multiline ? 3 : 1}
      maxlength={target.maxLength < 0 ? undefined : target.maxLength}
      aria-label={label}
      onkeydown={editorKey}></textarea>
    {#if titles.length}
      <div class="keyboard-suggestions" role="group" aria-label={t('Library suggestions')}>
        {#each suggestions as title (title)}
          <button
            type="button"
            data-nav
            data-title-suggestion={title}
            {title}
            onclick={() => onfinish(title)}>{title}</button
          >
        {:else}
          <span>{t('Type to find a game in your library')}</span>
        {/each}
      </div>
    {/if}
    <div class="keyboard-keys">
      {#each rows as row, rowIndex (rowIndex)}
        <div class="keyboard-row">
          {#each [...row] as letter, column (column)}
            {@const key = !symbols && shifted ? letter.toUpperCase() : letter}
            {#if rowIndex === 1 && column === 0}
              <button type="button" data-nav bind:this={first} onclick={() => enterKey(key)}
                ><span class="key-label">{key}</span></button
              >
            {:else}
              <button type="button" data-nav onclick={() => enterKey(key)}
                ><span class="key-label">{key}</span></button
              >
            {/if}
          {/each}
        </div>
      {/each}
      <div class="keyboard-row keyboard-actions">
        <button
          type="button"
          data-nav
          aria-label={t('Shift')}
          aria-pressed={shifted}
          onclick={() => (shifted = !shifted)}><ArrowBigUp size={20} /></button
        >
        <button
          type="button"
          data-nav
          aria-label={t('Symbols')}
          aria-pressed={symbols}
          onclick={() => (symbols = !symbols)}>{symbols ? 'ABC' : '#+='}</button
        >
        <button type="button" data-nav onclick={() => edit(' ')}>{t('Space')}</button>
        <button type="button" data-nav onclick={() => edit(multiline ? '\n' : '.')}
          >{multiline ? '↵' : '.'}</button
        >
        <button
          type="button"
          data-nav
          aria-label={t('Delete character')}
          onclick={() => edit('', true)}><Delete size={20} /></button
        >
        <button type="button" data-nav class="keyboard-done" onclick={commit}>{t('Done')}</button>
      </div>
    </div>
    <div class="keyboard-hints">
      <span><Glyph button="a" {family} />{t('Select')}</span>
      <span><Glyph button="x" {family} />{t('Delete character')}</span>
      <span><Glyph button="y" {family} />{t('Space')}</span>
      <span><Glyph button="lb" {family} /><Glyph button="rb" {family} />{t('Cursor')}</span>
      <span><Glyph button="rt" {family} />{t('Done')}</span>
      <span><Glyph button="b" {family} />{t('Back')}</span>
    </div>
  </dialog>
</div>

<style>
  .keyboard-clear {
    padding: 8px 12px;
    border: 1px solid #ffffff24;
    border-radius: 10px;
    background: #ffffff0e;
    color: inherit;
    font-size: 12px;
    white-space: nowrap;
  }
  .keyboard-backdrop {
    z-index: 12;
    align-items: flex-end;
    backdrop-filter: none;
    background: #090b1266;
    animation: none;
  }
  dialog.screen-keyboard[open] {
    width: min(710px, 100%);
    padding: clamp(12px, 2.6vw, 25px);
    background: linear-gradient(145deg, #3a4050d9, #171923e8 72%);
    backdrop-filter: blur(20px) saturate(145%);
    box-shadow:
      inset 0 1px #ffffff1c,
      0 24px 76px #0009;
    animation: none;
  }
  .keyboard-backdrop:global([inert]) {
    pointer-events: none;
  }
  :global(.solid) dialog.screen-keyboard[open] {
    background: #20222c;
    backdrop-filter: none;
  }
  .keyboard-heading {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-bottom: 10px;
  }
  .keyboard-heading h2 {
    flex: 1;
    font-size: 16px;
    margin: 0;
  }
  textarea {
    width: 100%;
    resize: none;
    padding: 10px 12px;
    background: #0c0e16aa;
    color: inherit;
    border: 1px solid #ffffff30;
    border-radius: 8px;
    font-size: 18px;
  }
  .keyboard-suggestions {
    display: flex;
    gap: 5px;
    align-items: center;
    min-height: 38px;
    margin: 4px 0;
    overflow: hidden;
  }
  .keyboard-suggestions button {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 8px;
    background: #ffffff0e;
  }
  .keyboard-suggestions span,
  .keyboard-hints {
    color: #bdbecc;
    font-size: 12px;
  }
  .keyboard-keys {
    display: grid;
    gap: 5px;
    margin-top: 8px;
  }
  .keyboard-row {
    display: flex;
    justify-content: center;
    gap: 5px;
  }
  .keyboard-row button {
    flex: 0 1 10%;
    min-width: 0;
    height: clamp(33px, 6dvh, 48px);
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    text-align: center;
    padding: 0;
    background: #ffffff12;
    box-shadow: inset 0 1px #ffffff16;
    border-radius: 9px;
    font-size: clamp(14px, 2.5vw, 19px);
  }
  .key-label {
    display: block;
    line-height: 1;
    pointer-events: none;
  }
  .keyboard-row button:active:not(:disabled) {
    transform: scale(0.94);
  }
  .keyboard-actions button {
    flex: 1;
    font-size: clamp(10px, 1.8vw, 14px);
  }
  .keyboard-actions button:nth-child(3),
  .keyboard-actions .keyboard-done {
    flex: 2;
  }
  .keyboard-actions .keyboard-done {
    background: #91b6ff39;
  }
  .keyboard-row button[aria-pressed='true'] {
    background: #91b6ff4d;
  }
  button:hover {
    background: #ffffff24;
  }
  button:focus-visible,
  :global(.controller-input) button:focus {
    background: #f2f4f8;
    color: #141622;
    outline: 2px solid #a9c6ff;
    outline-offset: -2px;
  }
  .keyboard-hints {
    display: flex;
    gap: 7px 13px;
    flex-wrap: wrap;
    padding-top: 12px;
  }
  .keyboard-hints span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
</style>
