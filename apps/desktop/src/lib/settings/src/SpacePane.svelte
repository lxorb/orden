<script lang="ts" module>
  import { owes, writing } from '../../parting/src/api'
  import type { InstructionsField } from './instructions-field.svelte'

  let current: InstructionsField | null = null
  owes(() => {
    if (current) writing(current.flush())
  })
</script>

<script lang="ts">
  import { untrack } from 'svelte'
  import { links } from '../../link-index/src/api'
  import { AGENTS_NAME } from '../../platform/src/api'
  import { onDisk } from '../../platform/src/api'
  import { canWriteAt } from '../../sharing/src/api'
  import { protection } from '../../protect/src/api'
  import { settings } from './window.svelte'
  import { folderOf, rootedAt, samePath } from '../../platform/src/api'
  import { joinPath } from '../../platform/src/api'
  import { noteText, workspace, writeNoteText } from '../../workspace/src/api'
  import { writeFile } from '../../file-writes/src/api'
  import { type FieldHands, InstructionsField as Field } from './instructions-field.svelte'

  const root = $derived(settings.space ?? workspace.activeSpace?.root ?? null)
  const name = $derived(rootedAt(workspace.spaces, root)?.name ?? '')
  const shut = $derived(root !== null && protection.locked(joinPath(root, AGENTS_NAME)))

  async function nudged() {
    const { sync } = await import('../../sync-store/src/api')
    sync.nudge()
  }

  const listed = (at: string) => workspace.spaces.some((one) => samePath(one.root, at))

  const shown = (path: string) => (protection.locked(path) ? Promise.resolve(null) : noteText(workspace, path))

  const hands: FieldHands = {
    space: async (path) => {
      const at = folderOf(path)
      return listed(at) && (await onDisk(at))
    },
    read: shown,
    there: onDisk,
    write: async (path, before, after, first) => {
      const took = await writeNoteText(workspace, path, before, after, {
        undoable: false,
        snapshot: first,
      })
      if (took) await nudged()
      return took
    },
    make: async (path, text) => {
      await writeFile(path, text)
      if (samePath(folderOf(path), workspace.activeSpace?.root)) await workspace.loadTree()
      await workspace.fileCame(path, 'file')
      await nudged()
    },
  }

  let field = $state.raw<Field | null>(null)
  let box = $state<HTMLTextAreaElement>()

  $effect(() => {
    if (root === null) return
    const at = root
    const path = joinPath(at, AGENTS_NAME)
    const closed = shut
    const one = new Field(path, hands, () => closed || !listed(at) || !canWriteAt(path))
    field = one
    current = one
    untrack(() => void one.load())

    const stop = links.hearSaves((saved, words) => {
      if (samePath(saved, path) && !closed) one.heard(words)
    })
    const back = () => void one.look()
    window.addEventListener('focus', back)

    return () => {
      stop()
      window.removeEventListener('focus', back)
      if (current === one) current = null
      writing(one.flush())
    }
  })

  $effect(() => {
    if (!settings.landsOnField || !box) return
    settings.landsOnField = false
    box.focus()
  })
</script>

{#if field}
  <div class="card">
    <label class="orden-setting setting tall">
      <span class="name"
        >Agent instructions{#if name}<small>{name}</small>{/if}</span
      >
      <textarea
        bind:this={box}
        rows="12"
        spellcheck="false"
        value={field.text}
        readonly={field.locked || !field.loaded}
        class:read={field.loaded && field.locked && field.text !== ''}
        oninput={(event) => field?.type(event.currentTarget.value)}
        onblur={() => void field?.flush()}></textarea>
    </label>
  </div>
{/if}

<style>
  .card {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .tall {
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding-block: var(--space-2);
  }

  .name {
    flex: 1;
  }

  small {
    margin-inline-start: var(--space-2);
    color: var(--muted);
    font-size: var(--text-sm);
  }

  textarea {
    flex: 1 0 100%;
    min-height: 12rem;
    padding: 6px 9px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.5;
    resize: vertical;
  }

  textarea.read {
    border-color: transparent;
    background: none;
  }
</style>
