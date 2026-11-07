<script module lang="ts">
  import { warmRenderer } from '../markdown-view.svelte'

  warmRenderer()
</script>

<script lang="ts">
  import { copyText } from '../clipboard'
  import { mathsWaiting } from '../markdown-view.svelte'
  import { drawInPieces } from './answer-pieces'
  import { patchHtml } from './patch-html'

  const {
    html,
    live = false,
    onfollow,
    onpicture,
  }: {
    html: string
    live?: boolean
    onfollow?: (event: MouseEvent) => void
    onpicture?: (src: string) => void
  } = $props()

  const waiting = $derived(mathsWaiting(html))

  function copied(event: MouseEvent): boolean {
    const button = (event.target as Element | null)?.closest<HTMLElement>('[data-copy]')
    const code = button?.closest('.code')?.querySelector('pre')?.textContent
    if (!button || code === undefined) return false
    void copyText(code)
    button.dataset.copied = ''
    setTimeout(() => delete button.dataset.copied, 1600)
    return true
  }

  function picture(event: MouseEvent): boolean {
    const button = (event.target as Element | null)?.closest<HTMLElement>('[data-picture]')
    const src = button?.dataset.picture
    if (!button || !src) return false
    onpicture?.(src)
    return true
  }

  function footnote(event: MouseEvent): boolean {
    const anchor = (event.target as Element | null)?.closest('a')
    const href = anchor?.getAttribute('href') ?? ''
    if (!anchor || !/^#fn(?:ref)?-/.test(href)) return false
    event.preventDefault()
    const words = anchor.closest('.words')
    const id = decodeURIComponent(href.slice(1))
    const there = [...(words?.querySelectorAll('[id]') ?? [])].find((one) => one.id === id)
    there?.scrollIntoView({ block: 'nearest' })
    return true
  }

  function press(event: MouseEvent) {
    if (copied(event) || picture(event) || footnote(event)) return
    onfollow?.(event)
  }
</script>

{#if live}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="words nib-write nib-answer live"
    dir="auto"
    class:waiting
    onclick={press}
    onauxclick={(event) => onfollow?.(event)}
    {@attach (node: HTMLDivElement) => patchHtml(node, html)}
  ></div>
{:else}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="words nib-write nib-answer"
    dir="auto"
    class:waiting
    onclick={press}
    onauxclick={(event) => onfollow?.(event)}
    {@attach (node: HTMLDivElement) => drawInPieces(node, html)}
  ></div>
{/if}

<style>
  .words:global(:is(#write, .nib-write)) {
    max-width: none;
    margin: 0;
    padding: 0;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    line-height: 1.55;
    overflow-wrap: anywhere;
  }

  .words:global(:is(#write, .nib-write)) > :global(:last-child) {
    margin-bottom: 0;
  }

  .words:global(:is(#write, .nib-write)) :global(:is(h1, h2, h3, h4, h5, h6)) {
    margin: 1.2em 0 0.5em;
  }

  .words:global(:is(#write, .nib-write)) > :global(:is(h1, h2, h3, h4, h5, h6):first-child) {
    margin-top: 0;
  }

  .words:global(:is(#write, .nib-write)) :global(a) {
    cursor: default;
  }

  .words:global(:is(#write, .nib-write)) :global(.task-list-item input[type='checkbox']) {
    margin: 0;
    inset-inline-start: -1.6em;
  }

  .words:global(:is(#write, .nib-write)) :global(.code) {
    margin: 1em 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--code-block-bg-color, var(--surface));
    overflow: hidden;
  }

  :global([data-skips-unseen]) .words :global(.code) {
    content-visibility: auto;
    contain-intrinsic-block-size: auto
      calc(var(--row-height-sm) + 1px + 2 * var(--space-2) + var(--lines, 6) * 0.86em * 1.6);
  }

  .words:global(:is(#write, .nib-write)) > :global(.code:first-child) {
    margin-top: 0;
  }

  .words:global(:is(#write, .nib-write)) :global(.code pre) {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 0;
    border-radius: 0;
    background: none;
    white-space: pre;
  }

  .words :global(.code-lines) {
    display: block;
  }

  .words :global(.code-bar) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--row-height-sm);
    padding-inline: var(--space-2) 2px;
    border-bottom: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
  }

  .words :global(:is(.code-copy, .picture-held)) {
    display: grid;
    place-items: center;
    width: var(--row-height-sm);
    height: calc(var(--row-height-sm) - 4px);
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .words :global(:is(.code-copy, .picture-held) svg) {
    width: 13px;
    height: 13px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .words :global(.code-copy[data-copied]) {
    color: var(--success);
  }

  .words :global(.picture-held) {
    display: inline-flex;
    gap: var(--space-1);
    width: auto;
    max-width: 100%;
    height: auto;
    padding: 2px var(--space-2);
    border: 1px solid var(--line);
    background: var(--surface-2);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    vertical-align: middle;
  }

  .words :global(.picture-held span) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (hover: hover) {
    .words :global(:is(.code-copy, .picture-held):hover) {
      background: var(--surface-hover);
      color: var(--text-strong);
    }
  }

  .waiting :global(:is(.math-inline, .math-block)) {
    visibility: hidden;
  }

  .live :global(.katex-error) {
    color: var(--muted) !important;
  }

  .live > :global(:last-child)::after {
    content: '';
    display: inline-block;
    width: 0.55em;
    height: 0.55em;
    margin-inline-start: 0.25em;
    border-radius: 50%;
    background: var(--text-strong);
    vertical-align: 0.05em;
    animation: breathe calc(var(--dur-slow) * 3) var(--ease-in-out) infinite;
  }

  @keyframes breathe {
    50% {
      opacity: 0.3;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .live > :global(:last-child)::after {
      animation: none;
    }
  }

  .words:global(:is(#write, .nib-write)) :global(a[href^='#cite-']) {
    display: inline-block;
    min-width: 1.35em;
    margin-inline: 1px;
    padding: 0 0.3em;
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    font-size: 0.72em;
    font-weight: var(--weight-strong);
    line-height: 1.5;
    text-align: center;
    text-decoration: none;
    vertical-align: 0.35em;
    transition: background var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .words:global(:is(#write, .nib-write)) :global(a[href^='#cite-']:hover) {
      text-decoration: none;
      background: var(--surface-press);
    }
  }

  :global([data-touch]) .words:global(:is(#write, .nib-write)) {
    font-size: var(--text-base);
  }
</style>
