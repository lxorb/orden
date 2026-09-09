<script lang="ts">
  /** The small bar that finds words on a page that cannot be typed in: a note
   *  being read, and a PDF.
   *
   *  Neither surface has a CodeMirror to ask, and a Tauri webview has no find bar
   *  of its own, so this is it. One component for both, because it is one thing:
   *  a field, how many were found and which one you are on, and the two steps
   *  through them. Where the words come from and how a match is shown is the
   *  caller's, since those are the only parts that differ.
   *
   *  The same shape the editor's own find sits in; see `.cm-panel.cm-search`. */

  import { t } from './i18n.svelte'

  const {
    query,
    count,
    /** Which match is the current one, counting from zero. */
    current,
    onstep,
    onclose,
    onquery,
  }: {
    query: string
    count: number
    current: number
    onstep: (by: number) => void
    onclose: () => void
    /** What was typed. The caller holds the query, because the caller is what
     *  searches with it. */
    onquery: (typed: string) => void
  } = $props()

  let field = $state<HTMLInputElement>()

  // The bar exists only while it is open, so arriving is the moment to take the
  // keyboard: whatever was typed last is there and selected, ready to replace.
  $effect(() => {
    field?.select()
    field?.focus()
  })
</script>

<div class="find">
  <input
    type="text"
    bind:this={field}
    value={query}
    placeholder={t('Find')}
    aria-label={t('Find')}
    oninput={(event: Event & { currentTarget: HTMLInputElement }) =>
      onquery(event.currentTarget.value)}
    onkeydown={(event: KeyboardEvent) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      onstep(event.shiftKey ? -1 : 1)
    }}
  />
  <span class="tally" aria-live="polite">
    {count ? `${current + 1}/${count}` : query ? '0' : ''}
  </span>
  <button
    title={t('Previous')}
    aria-label={t('Previous')}
    disabled={!count}
    onclick={() => onstep(-1)}
  >
    <svg viewBox="0 0 12 12"><path d="M2.5 7.5 6 4l3.5 3.5" /></svg>
  </button>
  <button title={t('Next')} aria-label={t('Next')} disabled={!count} onclick={() => onstep(1)}>
    <svg viewBox="0 0 12 12"><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>
  </button>
  <button class="shut" title={t('Close')} aria-label={t('Close')} onclick={onclose}>
    <svg viewBox="0 0 8 8"><path d="M1 1l6 6M7 1L1 7" /></svg>
  </button>
</div>

<style>
  .find {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    padding: 8px var(--space-4);
    background: var(--surface);
    border-bottom: 1px solid var(--line);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .find input {
    padding: 5px 9px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text-strong);
    font-family: inherit;
    font-size: inherit;
    outline: none;
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  .find input:focus {
    border-color: var(--accent);
  }

  .tally {
    min-width: 3.5em;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .find button {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .find button:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--text-strong);
  }

  .find button:active:not(:disabled) {
    background: var(--press);
  }

  .find button:disabled {
    opacity: 0.4;
  }

  .find .shut:hover {
    color: var(--danger);
  }

  .find button svg {
    width: 11px;
    height: 11px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .find .shut svg {
    width: 8px;
    height: 8px;
  }
</style>
