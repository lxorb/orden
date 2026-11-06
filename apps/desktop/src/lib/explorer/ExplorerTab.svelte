<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { i18n, plural, t } from '../i18n.svelte'
  import { shortcuts } from '../shortcuts.svelte'
  import { readableSize } from '../usage.svelte'
  import type { Tab } from '../workspace.svelte'
  import ExplorerBar from './ExplorerBar.svelte'
  import ExplorerList from './ExplorerList.svelte'
  import ExplorerPlaces from './ExplorerPlaces.svelte'
  import { explorerPrefs } from './prefs.svelte'
  import { viewOf } from './view.svelte'

  const { tab: shown, focused = false }: { tab: Tab; focused?: boolean } = $props()
  const tab = untrack(() => shown)
  const view = viewOf(tab)

  let typing = $state(false)
  let list = $state<{ focus: () => void }>()

  onMount(() => {
    void view.appear()
    return () => {
      view.stop()
    }
  })

  $effect(() => {
    if (focused && view.listing) untrack(() => list?.focus())
  })

  const counted = $derived.by(() => {
    const all = plural(view.rows.length, { one: '{count} item', other: '{count} items' })
    const picked = view.rows.filter((one) => view.picked.names.has(one.name))
    if (!picked.length) return all
    const size = readableSize(picked.reduce((sum, one) => sum + one.size, 0))
    return plural(
      picked.length,
      { one: '{all}, {count} selected ({size})', other: '{all}, {count} selected ({size})' },
      { all, size },
    )
  })

  function onkey(event: KeyboardEvent) {
    if (event.defaultPrevented || event.target instanceof HTMLInputElement) return
    const pressed = (id: string) => shortcuts.pressed(id, event)
    let run: (() => unknown) | null = null
    if (pressed('explorer.parent') || pressed('explorer.parent.alt')) run = () => view.up()
    else if (pressed('explorer.location')) run = () => (typing = true)
    else if (pressed('explorer.hidden')) run = () => explorerPrefs.toggleHidden()
    if (!run) return
    event.preventDefault()
    void run()
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="explorer" data-region="editor" onkeydown={onkey}>
  <ExplorerBar {view} bind:typing onleave={() => list?.focus()} />
  <div class="body">
    {#if explorerPrefs.places}
      <ExplorerPlaces {view} />
    {/if}
    <ExplorerList {view} bind:this={list} />
  </div>
  <div class="foot" role="status">
    {#if view.listing?.cut}
      <span class="cut"
        >{t('Only the first {count} are shown.', { count: i18n.amount(100_000) })}</span
      >
    {/if}
    <span>{counted}</span>
  </div>
</div>

<style>
  .explorer {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    font-family: var(--font-ui);
    container-type: inline-size;
  }

  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .foot {
    display: flex;
    flex: none;
    gap: var(--space-3);
    justify-content: flex-end;
    padding: var(--space-1) var(--space-3);
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .cut {
    margin-inline-end: auto;
  }
</style>
