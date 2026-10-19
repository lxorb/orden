<script lang="ts">
  /** The add row at the end of a group, and Todoist's inline editor it opens: quick add's
   *  field where the row is, knowing what the group is - its note, its section, its day,
   *  its label, its priority (TaskEditor.svelte). Enter adds and keeps the field for the
   *  next task; Escape or Cancel puts the row back. No toast: the new row arrives in the
   *  view above the field.
   *
   *  A view of notes adds a note where its filter points instead (add.ts), and a column
   *  that stands for a box's mark, which quick add cannot carry, takes the words in a
   *  plain field of its own and writes them with that mark. */
  import type { Group } from '@nib/bases'
  import { untrack } from 'svelte'
  import { t } from '../i18n.svelte'
  import type { Prefill as QuickPrefill } from '../quick-add/entry'
  import { relativeTo, withoutExtension } from '../space-paths'
  import { workspace } from '../workspace.svelte'
  import { addTyped, type Prefill, prefillOf } from './add'
  import type { Kit } from './kit'
  import TaskEditor from './TaskEditor.svelte'

  const {
    kit,
    group = null,
    asked = 0,
    onclose,
    onsize,
  }: {
    kit: Kit
    group?: Group | null
    /** Counts the times a key or the head's plus asked for the field rather than a
     *  press on the row: each new count opens it. */
    asked?: number
    /** The field put away, for a host that drew the row only to hold it. */
    onclose?: () => void
    /** How tall the field standing in the row is, as it changes; nought once it goes. */
    onsize?: (tall: number) => void
  } = $props()

  /** The plain field's prefill, for a column quick add cannot carry. */
  let plain = $state<Prefill | null>(null)
  /** The inline editor's, for every other task. */
  let editing = $state<QuickPrefill | null>(null)
  let words = $state('')
  let field = $state<HTMLInputElement>()

  const property = $derived(kit.live.view?.groupBy?.property)
  const notes = $derived((kit.live.view?.nib.rows ?? 'notes') === 'notes')
  /** A view of notes adds a note, where its filter points; see add.ts. */
  const label = $derived(notes ? t('New note') : t('Add task'))

  /** What the view's prefill is as quick add's: its note by its path in the space. */
  function quick(prefill: Prefill): QuickPrefill {
    const root = workspace.activeSpace?.root
    const note =
      prefill.path !== undefined && root !== undefined
        ? withoutExtension(relativeTo(root, prefill.path))
        : undefined
    return {
      ...(note === undefined ? {} : { note }),
      ...(prefill.heading === undefined ? {} : { heading: prefill.heading }),
      ...(prefill.due === undefined ? {} : { due: prefill.due }),
      ...(prefill.tags === undefined ? {} : { tags: prefill.tags }),
      ...(prefill.priority === undefined ? {} : { fields: { priority: prefill.priority } }),
    }
  }

  function start() {
    const at = group && property ? { property, key: group.key } : undefined
    if (notes) {
      kit.add(at)
      onclose?.()
      return
    }
    const prefill = prefillOf(kit.spec, kit.live.today, at)
    if (prefill.status !== undefined) {
      plain = prefill
      queueMicrotask(() => field?.focus())
      return
    }
    editing = quick(prefill)
  }

  $effect(() => {
    if (asked > 0) untrack(start)
  })

  function close() {
    plain = null
    editing = null
    words = ''
    onsize?.(0)
    onclose?.()
  }

  async function write() {
    const said = words
    if (!plain || !said.trim()) return
    words = ''
    await addTyped(said, plain)
  }
</script>

<div class="add-row">
  {#if plain}
    <div class="nib-row adding">
      <span class="plus" aria-hidden="true">
        <svg viewBox="0 0 13 13"><path d="M6.5 2v9M2 6.5h9" /></svg>
      </span>
      <input
        bind:this={field}
        bind:value={words}
        class="field"
        aria-label={t('Add task')}
        placeholder={t('Add task')}
        onkeydown={(event) => {
          if (event.isComposing) return
          if (event.key === 'Enter') {
            event.preventDefault()
            void write()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            close()
          }
        }}
        onblur={() => {
          if (!words.trim()) close()
        }}
      />
    </div>
  {:else}
    <button type="button" class="nib-row adder" onclick={start}>
      <span class="plus" aria-hidden="true">
        <svg viewBox="0 0 13 13"><path d="M6.5 2v9M2 6.5h9" /></svg>
      </span>
      <span class="nib-row-label">{label}</span>
    </button>
  {/if}
  {#if editing}
    <TaskEditor {kit} prefill={editing} {onsize} onclose={close} />
  {/if}
</div>

<style>
  .add-row {
    position: relative;
  }

  .adder,
  .adding {
    color: var(--muted);
  }

  .plus {
    flex: none;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
  }

  .plus svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
  }

  @media (hover: hover) {
    .adder:hover {
      color: var(--accent);
    }
  }

  .field {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    color: var(--text-strong);
    font: inherit;
  }

  .field::placeholder {
    color: var(--muted);
  }
</style>
