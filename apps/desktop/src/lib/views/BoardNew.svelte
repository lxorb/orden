<script lang="ts">
  import type { Group, Value } from '@orden/bases'
  import { untrack } from 'svelte'
  import { ADD_MARK } from './marks'
  import { addNote } from './add'
  import type { Kit } from './kit'

  const {
    kit,
    group,
    property,
    list = false,
    lane,
    asked = 0,
    onmade,
  }: {
    kit: Kit
    group: Group
    property: string | undefined
    list?: boolean
    lane?: { property: string; key: Value; list: boolean } | undefined
    asked?: number
    onmade?: (path: string) => void
  } = $props()

  let typing = $state(false)
  let words = $state('')
  let field = $state<HTMLInputElement>()
  let making = false

  let seen = untrack(() => asked)
  $effect(() => {
    if (asked <= seen) return
    seen = asked
    untrack(open)
  })

  function open() {
    typing = true
    queueMicrotask(() => field?.focus())
  }

  function valued(): Record<string, Value> {
    const out: Record<string, Value> = {}
    const key = group.key
    if (property?.startsWith('note.') && key !== null) out[property.slice(5)] = list ? [key] : key
    if (lane?.property.startsWith('note.') && lane.key !== null && lane.key !== '')
      out[lane.property.slice(5)] = lane.list ? [lane.key] : lane.key
    return out
  }

  async function commit(again: boolean) {
    const title = words.trim()
    const base = kit.live.base
    if (!title || !base || making) {
      if (!again) typing = false
      return
    }
    making = true
    words = ''
    let path: string | null = null
    try {
      path = await addNote(
        base,
        kit.live.at,
        kit.file,
        property ? { property, key: group.key } : undefined,
        { title, open: false, properties: valued() },
      )
      if (path) onmade?.(path)
    } catch {
      if (!words) words = title
      typing = true
      return
    } finally {
      making = false
      if (!path) words ||= title
    }
    if (again) field?.focus()
    else if (path) typing = false
  }
</script>

{#if typing}
  <div class="card">
    <input
      class="field"
      bind:this={field}
      bind:value={words}
      aria-label="New page"
      placeholder="Untitled"
      onkeydown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          void commit(true)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          words = ''
          typing = false
        }
      }}
      onblur={() => void commit(false)}
    />
  </div>
{:else}
  <button type="button" class="new" data-new-page onclick={open}>
    <svg viewBox="0 0 13 13" aria-hidden="true"><path d={ADD_MARK} /></svg>
    New page
  </button>
{/if}

<style>
  .card {
    box-sizing: border-box;
    margin: 0 var(--space-2) var(--space-2);
    padding: 7px var(--space-3);
    border: 1px solid var(--accent-line);
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }

  .field {
    width: 100%;
    padding: 0;
    border: none;
    outline: none;
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    font-weight: var(--weight-strong);
  }

  .new {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: calc(100% - 2 * var(--space-1));
    height: var(--row-height);
    margin: 0 var(--space-1) var(--space-1);
    padding: 0 var(--space-2);
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .new:hover {
      background: var(--surface-hover);
      color: var(--text);
    }
  }

  .new:active {
    background: var(--surface-press);
  }

  .new svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
  }
</style>
