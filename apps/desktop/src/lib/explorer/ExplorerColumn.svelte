<script lang="ts">
  import { joinPath } from '../tauri'
  import { type Entry, listFolder } from './commands'
  import EntryMark from './EntryMark.svelte'
  import { openFile } from './open'
  import { ordered } from './order'
  import { explorerPrefs } from './prefs.svelte'
  import type { ExplorerView } from './view.svelte'

  const {
    view,
    folder,
    lit = null,
  }: { view: ExplorerView; folder: string; lit?: string | null } = $props()

  let entries = $state.raw<Entry[]>([])
  let listed = $state<string | null>(null)
  const SETTLED_MS = 120

  $effect(() => {
    const at = folder
    let gone = false
    const waiting = setTimeout(() => {
      void listFolder(at)
        .then((listing) => {
          if (gone) return
          entries = listing.entries
          listed = listing.path
        })
        .catch(() => {
          if (!gone) entries = []
        })
    }, SETTLED_MS)
    return () => {
      gone = true
      clearTimeout(waiting)
    }
  })

  const rows = $derived(ordered(entries, explorerPrefs.sort, explorerPrefs.hidden))

  const SPARE = 8
  let scrollTop = $state(0)
  let height = $state(0)
  let rowHeight = $state(28)
  let scroller = $state<HTMLElement>()

  const drawn = $derived.by(() => {
    const first = Math.max(0, Math.floor(scrollTop / rowHeight) - SPARE)
    const last = Math.min(rows.length, Math.ceil((scrollTop + height) / rowHeight) + SPARE)
    const at: number[] = []
    for (let one = first; one < last; one++) at.push(one)
    return at
  })

  function measure(node: HTMLElement) {
    if (node.offsetHeight > 0) rowHeight = node.offsetHeight
  }

  function press(entry: Entry) {
    const path = joinPath(listed ?? folder, entry.name)
    if (entry.folder) void view.go(path)
    else void openFile(path)
  }
</script>

<div
  class="column"
  bind:this={scroller}
  bind:clientHeight={height}
  onscroll={() => (scrollTop = scroller?.scrollTop ?? 0)}
>
  <ul class="room" style:height="{rows.length * rowHeight}px">
    {#each drawn as index (rows[index]?.name ?? index)}
      {@const entry = rows[index]}
      {#if entry}
        <li style:top="{index * rowHeight}px" use:measure>
          <button
            class="orden-row"
            class:is-on={lit === entry.name}
            class:is-quiet={entry.hidden}
            tabindex="-1"
            onclick={() => press(entry)}
          >
            <EntryMark path={joinPath(listed ?? folder, entry.name)} folder={entry.folder} />
            <span class="orden-row-label">{entry.name}</span>
          </button>
        </li>
      {/if}
    {/each}
  </ul>
</div>

<style>
  .column {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding: var(--space-1);
    overflow-y: auto;
    border-inline-end: 1px solid var(--line);
  }

  .room {
    position: relative;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .room > li {
    position: absolute;
    inset-inline: 0;
  }
</style>
