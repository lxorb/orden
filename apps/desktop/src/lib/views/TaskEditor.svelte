<script lang="ts">
  import type { Row } from '@orden/bases'
  import { ai } from '../ai/store.svelte'
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
    root: into,
    onclose,
    onsize,
  }: {
    kit: Kit
    row?: Row | null
    prefill?: Prefill
    root?: string | undefined
    onclose: () => void
    onsize?: ((tall: number) => void) | undefined
  } = $props()

  const root = $derived(workspace.activeSpace?.root ?? null)
  const notes = $derived(root ? noteNames(root) : [])
  const tags = $derived(labelsOf(kit.live.rows))

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
      await addTask(entry, into === undefined ? { open } : { open, root: into })
      if (open) onclose()
      return
    }
    const words = entry.description ?? ''
    await editTask(row, changeOf(row.task, entry), description === null ? null : words)
    onclose()
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
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
      provider={ai.providerFor('ask')}
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
