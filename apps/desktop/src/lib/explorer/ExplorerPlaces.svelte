<script lang="ts">
  import Folder from 'lucide/dist/esm/icons/folder.mjs'
  import type { IconNode } from 'lucide'
  import { menu } from '../menu.svelte'
  import { roving } from '../roving'
  import { nameOf, samePath, within } from '../space-paths'
  import { dropInto, over } from './drag'
  import { dropOver, isExplorerDrag, explorerDragged } from '../drag-paths'
  import { placeMark, placeName, places } from './places.svelte'
  import type { ExplorerView } from './view.svelte'

  const { view }: { view: ExplorerView } = $props()

  $effect(() => {
    void places.ask()
  })

  const rows = $derived([
    ...places.list.map((one) => ({
      path: one.path,
      name: placeName(one),
      mark: placeMark(one),
      pinned: false,
    })),
    ...places.pinned
      .filter((path) => !places.list.some((one) => samePath(one.path, path)))
      .map((path) => ({
        path,
        name: nameOf(path) || path,
        mark: Folder,
        pinned: true,
      })),
  ])

  const here = $derived.by(() => {
    const folder = view.folder
    if (!folder) return null
    let best: string | null = null
    for (const one of rows) {
      const holds = within(one.path, folder) !== null
      if (holds && (best === null || one.path.length > best.length)) best = one.path
    }
    return best
  })

  let taking = $state<string | null>(null)

  function pinDropped(event: DragEvent) {
    const target = event.target instanceof Element ? event.target : null
    if (!isExplorerDrag(event.dataTransfer) || target?.closest('.place')) return
    event.preventDefault()
    for (const path of explorerDragged(event.dataTransfer)) {
      const entry = view.rows.find((one) => samePath(view.pathOf(one.name), path))
      if (entry?.folder) places.pin(path)
    }
    taking = null
  }

  function rowMenu(event: MouseEvent, path: string, pinned: boolean) {
    if (!pinned) return
    event.preventDefault()
    menu.show(event, [{ label: 'Unpin', run: () => places.unpin(path) }])
  }
</script>

{#snippet mark(drawn: IconNode)}
  <svg class="orden-row-mark" viewBox="0 0 24 24" aria-hidden="true">
    {#each drawn as [tag, attrs], index (index)}
      <svelte:element this={tag} {...attrs} />
    {/each}
  </svg>
{/snippet}

<nav
  class="places"
  aria-label="Places"
  use:dropOver={(event) => {
    if (isExplorerDrag(event.dataTransfer)) event.preventDefault()
  }}
  ondrop={pinDropped}
>
  <ul use:roving={{ rows: '.place', current: '.place.is-on' }}>
    {#each rows as row (row.path)}
      <li>
        <button
          class="orden-row place"
          class:is-on={here !== null && samePath(row.path, here)}
          class:is-taking={taking === row.path}
          title={row.path}
          onclick={() => view.go(row.path)}
          oncontextmenu={(event) => rowMenu(event, row.path, row.pinned)}
          use:dropOver={(event) => {
            if (over(event)) taking = row.path
          }}
          ondragleave={() => (taking = null)}
          ondrop={(event) => {
            taking = null
            dropInto(view, event, row.path)
          }}
        >
          {@render mark(row.mark)}
          <span class="orden-row-label">{row.name}</span>
        </button>
      </li>
    {/each}
  </ul>
</nav>

<style>
  .places {
    flex: none;
    width: 12rem;
    padding: var(--space-1);
    overflow-y: auto;
    border-inline-end: 1px solid var(--line);
  }

  @container (max-width: 34rem) {
    .places {
      display: none;
    }
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
