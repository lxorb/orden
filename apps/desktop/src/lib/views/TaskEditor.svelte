<script lang="ts">
  /** Todoist's inline editor: quick add's field standing in a list, where a task is added
   *  (the end of a section, a day, a column) or where one is changed (Ctrl+E, the pencil).
   *  It floats over the rows under it rather than pushing them down, so the list's
   *  arithmetic of rows stays what it was; Escape or Cancel puts it away.
   *
   *  Adding keeps it up for the next task, the way quick add does; a task's own words and
   *  fields saved put it away. Every write is quick add's own (quick-add/write.ts) or the
   *  views' one write path (act.ts). */
  import type { Row } from '@nib/bases'
  import { onMount } from 'svelte'
  import { i18n } from '../i18n.svelte'
  import { quickAdd } from '../quick-add/asked.svelte'
  import type { Entry, Prefill } from '../quick-add/entry'
  import QuickAdd from '../quick-add/QuickAdd.svelte'
  import { addTask, headingsOf, noteNames } from '../quick-add/write'
  import { workspace } from '../workspace.svelte'
  import { noteText } from '../workspace/note-text'
  import { editTask } from './act'
  import { type Kit, notePath } from './kit'
  import { descriptionOf } from './task-body'
  import { changeOf, prefillFor } from './task-edit'
  import { labelsOf } from './task-meta'

  const {
    kit,
    row = null,
    prefill = {},
    onclose,
    onsize,
  }: {
    kit: Kit
    /** The task being changed; a new one is added where absent. */
    row?: Row | null
    prefill?: Prefill
    onclose: () => void
    /** How tall it is drawn, as that changes, so the list can make room under it. */
    onsize?: ((tall: number) => void) | undefined
  } = $props()

  const root = $derived(workspace.activeSpace?.root ?? null)
  const notes = $derived(root ? noteNames(root) : [])
  const tags = $derived(labelsOf(kit.live.rows))

  /** What the field starts with: the prefill, or the task and its description as they are
   *  now, read once. */
  let start = $state<Prefill | null>(null)
  let description: string | null = null

  let box = $state<HTMLElement>()
  $effect(() => {
    const node = box
    if (!node || !onsize) return
    const tell = onsize
    const watch = new ResizeObserver(() => tell(node.offsetHeight))
    watch.observe(node)
    return () => watch.disconnect()
  })

  onMount(() => {
    const task = row?.task
    if (!row || !task) {
      start = prefill
      return
    }
    void (async () => {
      const path = notePath(row)
      const text = path === null ? null : await noteText(workspace, path)
      const anchor = row.anchor
      description = text && anchor ? (descriptionOf(text, anchor)?.text ?? '') : null
      start = prefillFor(task, description === '' ? null : description)
    })()
  })

  async function submit(entry: Entry, open: boolean) {
    if (!row?.task) {
      await addTask(entry, { open })
      if (open) onclose()
      return
    }
    const words = entry.description ?? ''
    await editTask(row, changeOf(row.task, entry), description === null ? null : words)
    onclose()
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- Its keys, presses and drags are the field's own, not the row's under it. -->
<div
  bind:this={box}
  class="editor"
  onkeydown={(event) => event.stopPropagation()}
  onpointerdown={(event) => event.stopPropagation()}
  oncontextmenu={(event) => event.stopPropagation()}
  onclick={(event) => event.stopPropagation()}
>
  {#if start}
    <QuickAdd
      langs={[i18n.language]}
      {notes}
      {tags}
      headingsOf={(note: string) => (root ? headingsOf(root, note) : [])}
      prefill={start}
      smart={quickAdd.smart}
      mode={row ? 'edit' : 'add'}
      onsubmit={submit}
      {onclose}
      oncancel={onclose}
    />
  {/if}
</div>

<style>
  /* Over the rows under it, at the width of the list: a card of the field, in the
     elevation a thing that floats over a panel wears. */
  .editor {
    position: absolute;
    inset: 0 0 auto;
    z-index: var(--z-lifted);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    box-shadow: var(--shadow-md);
  }

  .editor :global(.quick) {
    padding: var(--space-2) var(--space-3);
  }
</style>
