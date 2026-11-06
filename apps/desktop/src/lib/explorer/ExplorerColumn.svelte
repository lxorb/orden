<script lang="ts">
  import { fileMark } from '../file-mark'
  import FileMark from '../FileMark.svelte'
  import { joinPath } from '../tauri'
  import { type Entry, listFolder } from './commands'
  import { openFile } from './open'
  import { ordered } from './order'
  import { explorerPrefs } from './prefs.svelte'
  import type { ExplorerView } from './view.svelte'

  const {
    view,
    folder,
    lit = null,
  }: { view: ExplorerView; folder: string; lit?: string | null } = $props()

  let entries = $state<Entry[]>([])
  let listed = $state<string | null>(null)

  $effect(() => {
    const at = folder
    let gone = false
    void listFolder(at)
      .then((listing) => {
        if (gone) return
        entries = listing.entries
        listed = listing.path
      })
      .catch(() => {
        if (!gone) entries = []
      })
    return () => {
      gone = true
    }
  })

  const rows = $derived(ordered(entries, explorerPrefs.sort, explorerPrefs.hidden))

  function press(entry: Entry) {
    const path = joinPath(listed ?? folder, entry.name)
    if (entry.folder) void view.go(path)
    else void openFile(path, entry.name)
  }
</script>

<ul class="column">
  {#each rows as entry (entry.name)}
    <li>
      <button
        class="nib-row"
        class:is-on={lit === entry.name}
        class:is-quiet={entry.hidden}
        tabindex="-1"
        onclick={() => press(entry)}
      >
        <FileMark mark={entry.folder ? 'folder' : fileMark(entry.name)} />
        <span class="nib-row-label">{entry.name}</span>
      </button>
    </li>
  {/each}
</ul>

<style>
  .column {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding: var(--space-1);
    overflow-y: auto;
    border-inline-end: 1px solid var(--line);
    list-style: none;
  }
</style>
