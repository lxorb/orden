<script lang="ts">
  import type { Group } from '@orden/bases'
  import { untrack } from 'svelte'
  import type { Prefill as QuickPrefill } from '../quick-add/entry'
  import { relativeTo, withoutExtension } from '../space-paths'
  import { workspace } from '../workspace.svelte'
  import { addTyped, type Prefill, prefillOf } from './add'
  import { narrowing } from './display'
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
    asked?: number
    onclose?: () => void
    onsize?: (tall: number) => void
  } = $props()

  let plain = $state<Prefill | null>(null)
  let editing = $state<QuickPrefill | null>(null)
  let into = $state<string | undefined>()
  let words = $state('')
  let field = $state<HTMLInputElement>()

  const property = $derived(kit.live.view?.groupBy?.property)
  const notes = $derived((kit.live.view?.orden.rows ?? 'notes') === 'notes')
  const label = $derived(notes ? 'New note' : 'Add task')

  function quick(prefill: Prefill): QuickPrefill {
    const root = prefill.root ?? workspace.activeSpace?.root
    const note =
      prefill.path !== undefined && root !== undefined
        ? withoutExtension(relativeTo(root, prefill.path))
        : undefined
    return {
      ...(note === undefined ? {} : { note }),
      ...(prefill.heading === undefined ? {} : { heading: prefill.heading }),
      ...(prefill.due === undefined ? {} : { due: prefill.due }),
      ...(prefill.tags === undefined ? {} : { tags: prefill.tags }),
      fields: {
        ...(prefill.priority === undefined ? {} : { priority: prefill.priority }),
        ...(prefill.deadline === undefined ? {} : { deadline: prefill.deadline }),
        ...(prefill.assignee === undefined ? {} : { assignee: prefill.assignee }),
      },
    }
  }

  function start() {
    const at = group && property ? { property, key: group.key } : undefined
    if (notes) {
      kit.add(at)
      onclose?.()
      return
    }
    const prefill = prefillOf(kit.spec, kit.live.today, at, narrowing(kit.live.view))
    if (prefill.status !== undefined) {
      plain = prefill
      queueMicrotask(() => field?.focus())
      return
    }
    into = prefill.root
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
    if (!(await addTyped(said, plain)) && !words) words = said
  }
</script>

{#if kit.adds}
  <div class="add-row">
    {#if plain}
      <div class="orden-row adding">
        <span class="plus" aria-hidden="true">
          <svg viewBox="0 0 13 13"><path d="M6.5 2v9M2 6.5h9" /></svg>
        </span>
        <input
          bind:this={field}
          bind:value={words}
          class="field"
          aria-label="Add task"
          placeholder="Add task"
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
      <button type="button" class="orden-row adder" onclick={start}>
        <span class="plus" aria-hidden="true">
          <svg viewBox="0 0 13 13"><path d="M6.5 2v9M2 6.5h9" /></svg>
        </span>
        <span class="orden-row-label">{label}</span>
      </button>
    {/if}
    {#if editing}
      <TaskEditor {kit} prefill={editing} root={into} {onsize} onclose={close} />
    {/if}
  </div>
{/if}

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
