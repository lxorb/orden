<script lang="ts">
  import { tooLongToParse, type VimMode } from '@orden/editor'
  import { countText } from './counts'
  import { chrome } from './theme/src/api'
  import { localNumber } from './platform/src/api'
  import { VIM_WORDS } from './modes.svelte'
  import { pages } from './pages/src/api'
  import { views } from './views.svelte'
  import { workspace } from './workspace.svelte'

  const {
    doc = '',
    reading = false,
    vimMode = null,
  }: { doc?: string; reading?: boolean; vimMode?: VimMode | null } = $props()

  const paper = $derived.by(() => {
    const store = pages.of(workspace.active?.id)
    return store ? { at: store.showing, count: store.pages.length } : null
  })

  const plain = $derived(!paper && tooLongToParse(doc.length))

  let looking = $state(false)

  let held = $state(false)

  const asked = $derived(looking || held)

  const counts = $derived(asked ? countText(doc) : null)

  const chosen = $derived(asked && views.chosen > 0 ? countText(views.selectedText()) : null)

  const said = (part: number | undefined, whole: number) =>
    part === undefined ? localNumber(whole) : `${localNumber(part)}/${localNumber(whole)}`
</script>

{#if vimMode}
  <span class="mode" class:writing={vimMode !== 'normal'}>{VIM_WORDS[vimMode]}</span>
{/if}

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<footer
  data-theme={chrome.theme}
  class:looking={looking || held || reading || !!paper}
  class:paper={!!paper}
  data-region="status"
  data-chrome="bottom"
  tabindex="0"
  aria-label="What this note is"
  onpointerenter={() => (looking = true)}
  onpointerleave={() => (looking = false)}
  onfocus={() => (held = true)}
  onblur={() => (held = false)}
>
  {#if reading}
    <span class="reading">Read-only</span>
  {/if}
  {#if plain}
    <span class="reading" title="Shown as plain text, so typing stays instant in a note this long"
      >No preview</span
    >
  {/if}
  {#if paper}
    <span class="page">{paper.at} / {paper.count}</span>
  {/if}
  {#if counts}
    <span>{said(chosen?.words, counts.words)}w</span>
    <span>{said(chosen?.characters, counts.characters)}c</span>
    <span>{localNumber(counts.lines)}l</span>
    <span>{counts.minutes}m</span>
  {/if}
</footer>

<style>
  .mode {
    position: absolute;
    inset-inline-start: var(--card-room);
    bottom: var(--card-room);
    z-index: var(--z-float);
    padding: 4px var(--space-4);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    color: var(--muted);
    transition: color var(--dur-base) var(--ease-out);
    user-select: none;
    -webkit-user-select: none;
    pointer-events: none;
  }

  .mode.writing {
    color: var(--accent);
  }

  footer {
    position: absolute;
    inset-inline-end: var(--card-room);
    bottom: var(--card-room);
    z-index: var(--z-float);
    display: flex;
    gap: var(--space-3);
    min-width: var(--space-7);
    min-height: 1.4em;
    padding: 4px var(--space-4);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted);
    opacity: 0;
    transition: opacity var(--dur-slow) var(--ease-out);
    user-select: none;
    -webkit-user-select: none;
    pointer-events: auto;
  }

  footer.looking {
    opacity: 1;
  }

  .reading {
    letter-spacing: 0.03em;
  }

  .page {
    color: var(--muted-strong);
  }

  :global([data-touch]) footer,
  :global([data-touch]) .mode {
    display: none;
  }

  :global([data-touch]) footer.paper {
    display: flex;
    pointer-events: none;
    bottom: var(--inset-bottom);
  }
</style>
