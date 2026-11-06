<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { i18n, plural, t } from '../i18n.svelte'
  import { shortcuts } from '../shortcuts.svelte'
  import { fileClipboard } from '../list-landing.svelte'
  import { readableSize } from '../usage.svelte'
  import { type Tab, workspace } from '../workspace.svelte'
  import { newFolder, paste, removeForGood, trash } from './changes'
  import { jobs } from './jobs.svelte'
  import ExplorerBar from './ExplorerBar.svelte'
  import ExplorerList from './ExplorerList.svelte'
  import ExplorerLook from './ExplorerLook.svelte'
  import ExplorerPlaces from './ExplorerPlaces.svelte'
  import ExplorerPreview from './ExplorerPreview.svelte'
  import { explorerPrefs } from './prefs.svelte'
  import { viewOf } from './view.svelte'

  const { tab: shown, focused = false }: { tab: Tab; focused?: boolean } = $props()
  const tab = untrack(() => shown)
  const view = viewOf(tab)

  let typing = $state(false)
  let filtering = $state(false)
  let looking = $state(false)
  let list = $state<{ focus: () => void; menuHere: () => void }>()

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
    const chosen = view.chosen
    if (event.key === 'Escape' && (view.search || view.filter)) {
      run = () => {
        view.filter = ''
        view.endSearch()
        filtering = false
      }
    } else if (pressed('explorer.filter')) run = () => (filtering = true)
    else if (pressed('explorer.search')) {
      run = () => {
        if (view.filter.trim()) view.searchBelow(view.filter)
        else filtering = true
      }
    } else if (pressed('explorer.look') && view.picked.cursor !== null) run = () => (looking = true)
    else if (pressed('explorer.preview')) run = () => explorerPrefs.togglePreview()
    else if (pressed('explorer.list')) run = () => explorerPrefs.show('list')
    else if (pressed('explorer.grid')) run = () => explorerPrefs.show('grid')
    else if (pressed('explorer.parent') || pressed('explorer.parent.alt')) run = () => view.up()
    else if (pressed('explorer.location')) run = () => (typing = true)
    else if (pressed('explorer.hidden')) run = () => explorerPrefs.toggleHidden()
    else if (pressed('explorer.new-folder')) run = () => newFolder(view)
    else if (pressed('explorer.delete')) run = () => removeForGood(view, chosen)
    else if (pressed('tree.delete')) run = () => trash(view, chosen)
    else if (pressed('tree.rename') && view.picked.cursor !== null)
      run = () => (view.renaming = view.picked.cursor)
    else if (pressed('fixed.copy') && chosen.length) run = () => fileClipboard.hold(chosen, false)
    else if (pressed('fixed.cut') && chosen.length) run = () => fileClipboard.hold(chosen, true)
    else if (pressed('fixed.paste')) run = () => paste(view)
    else if (pressed('edit.undo')) run = () => workspace.undoFileAction()
    else if (pressed('edit.redo') || pressed('edit.redo.alt'))
      run = () => workspace.redoFileAction()
    else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))
      run = () => list?.menuHere()
    if (!run) return
    event.preventDefault()
    void run()
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="explorer" data-region="editor" onkeydown={onkey}>
  <ExplorerBar {view} bind:typing bind:filtering onleave={() => list?.focus()} />
  <div class="body">
    {#if explorerPrefs.places}
      <ExplorerPlaces {view} />
    {/if}
    <ExplorerList {view} bind:this={list} />
    {#if explorerPrefs.preview}
      <ExplorerPreview {view} />
    {/if}
    {#if looking}
      <ExplorerLook
        {view}
        onclose={() => {
          looking = false
          list?.focus()
        }}
      />
    {/if}
  </div>
  {#each jobs.list.filter((one) => one.shown) as job (job.id)}
    <div class="job" role="status">
      <span class="what">{job.label}</span>
      <div class="nib-meter">
        <div
          class="nib-meter-fill"
          style:width="{job.total ? Math.min(100, (job.bytes / job.total) * 100) : 0}%"
        ></div>
      </div>
      <span class="far">{readableSize(job.bytes)} / {readableSize(job.total)}</span>
      <button type="button" class="nib-button is-quiet" onclick={() => jobs.cancel(job.id)}
        >{t('Cancel')}</button
      >
    </div>
  {/each}
  <div class="foot" role="status">
    {#if view.said}
      <span class="said">{view.said}</span>
    {:else if view.search && !view.search.done}
      <span class="cut">{t('Searching…')}</span>
    {:else if view.listing?.cut}
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
    position: relative;
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

  .cut,
  .said {
    margin-inline-end: auto;
  }

  .said {
    color: var(--danger);
  }

  .job {
    display: grid;
    flex: none;
    grid-template-columns: minmax(0, 1fr) minmax(6rem, 14rem) auto auto;
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-1) var(--space-3);
    border-top: 1px solid var(--line);
    font-size: var(--text-xs);
  }

  .what {
    overflow: hidden;
    color: var(--text);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .far {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
</style>
