<script module lang="ts">
  import { warmRenderer } from '../markdown-view.svelte'

  // A surface that draws answers is about to: what the first of them is likely to
  // want is fetched now rather than once it is on the screen.
  warmRenderer()
</script>

<script lang="ts">
  /** A model's answer, drawn: the words of ai/drawn.ts, which is a note's own page at
   *  the size a panel reads - the surface every note is read on (`nib-write`), so a
   *  table, a formula, a task list or a quote is the same thing here as in a note -
   *  with the citation chips the Ask panel numbers its passages with. Every press on a
   *  link inside it is the caller's, through `onfollow`, but for a footnote's, which
   *  goes to its note in these words. The Ask panel's and the quick question's, so the
   *  two read as one thing.
   *
   *  A code block's copy button and a held picture's (drawn.ts puts both there) are
   *  answered here, and while the words are still arriving a dot breathes at their
   *  end, ChatGPT's cursor. A formula whose engine has not landed yet is kept out of
   *  sight rather than shown as its TeX, and drawn as the engine lands. */
  import { copyText } from '../clipboard'
  import { mathsWaiting } from '../markdown-view.svelte'

  const {
    html,
    live = false,
    onfollow,
    onpicture,
  }: {
    html: string
    live?: boolean
    onfollow?: (event: MouseEvent) => void
    /** A held picture was pressed: its address, to be shown from now on. */
    onpicture?: (src: string) => void
  } = $props()

  const waiting = $derived(mathsWaiting(html))

  /** A press on a code block's copy button: its block's words, and a tick for a moment. */
  function copied(event: MouseEvent): boolean {
    const button = (event.target as Element | null)?.closest<HTMLElement>('[data-copy]')
    const code = button?.closest('.code')?.querySelector('pre')?.textContent
    if (!button || code === undefined) return false
    void copyText(code)
    button.dataset.copied = ''
    setTimeout(() => delete button.dataset.copied, 1600)
    return true
  }

  /** A press on a held picture: shown, from now on, wherever these words are drawn. */
  function picture(event: MouseEvent): boolean {
    const button = (event.target as Element | null)?.closest<HTMLElement>('[data-picture]')
    const src = button?.dataset.picture
    if (!button || !src) return false
    onpicture?.(src)
    return true
  }

  /** A footnote's mark and its way back: a place in these words, not a note. */
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

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="words nib-write nib-answer"
  class:live
  class:waiting
  onclick={press}
  onauxclick={(event) => onfollow?.(event)}
>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- the renderer escapes every tag the model wrote; see ai/drawn.ts -->
  {@html html}
</div>

<style>
  /* A note's page at a panel's size. Every rule a note is read by reaches these words
     through `nib-write`; what is said here is only what a panel is not a page in: the
     column is the panel's and the page's own room around it is none, and the words are
     the size a row of the panel reads at. Said against the surface itself, which is an
     id rule's specificity, so it wins over the page's own. */
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

  /* A heading opens a part of an answer, not a chapter of a page. */
  .words:global(:is(#write, .nib-write)) :global(:is(h1, h2, h3, h4, h5, h6)) {
    margin: 1.2em 0 0.5em;
  }

  .words:global(:is(#write, .nib-write)) > :global(:is(h1, h2, h3, h4, h5, h6):first-child) {
    margin-top: 0;
  }

  .words:global(:is(#write, .nib-write)) :global(a) {
    cursor: default;
  }

  /* A task's box in the list's gutter, which at a row's size is narrower than a page's:
     the box keeps its own size, so it goes a little further out, clear of the words. */
  .words:global(:is(#write, .nib-write)) :global(.task-list-item input[type='checkbox']) {
    margin: 0;
    inset-inline-start: -1.6em;
  }

  /* A code block with its bar: the language and the copy button over it, one box. */
  .words:global(:is(#write, .nib-write)) :global(.code) {
    margin: 1em 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--code-block-bg-color, var(--surface));
    overflow: hidden;
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

  /* A picture from elsewhere, held until it is asked for: its words, and a frame. */
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

  /* A formula whose engine is still on its way keeps its place, unseen, rather than
     showing the TeX it is written in for the moment until it lands. */
  .waiting :global(:is(.math-inline, .math-block)) {
    visibility: hidden;
  }

  /* A formula still being written cannot parse yet: its source, quietly, rather than
     the red of one that is wrong. */
  .live :global(.katex-error) {
    color: var(--muted) !important;
  }

  /* Words still arriving: a dot breathing where the next one will be. */
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

  /* A citation: the passage's number, small and raised, the accent's own chip. */
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
