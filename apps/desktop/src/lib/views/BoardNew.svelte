<script lang="ts">
  /** A column's New page, Notion's: a press opens a card to type the title into, and
   *  Enter makes the note in that column (its value written, the base's template, the
   *  filter's pinned values) and leaves a fresh card for the next one. Nothing is
   *  written before a title is: Escape, or leaving it empty, writes nothing. The title
   *  is the note's name on disk, with what a file name cannot hold replaced (add.ts).
   *
   *  `asked` counts the times a key asked for it rather than a press. */
  import type { Group, Value } from '@nib/bases'
  import { untrack } from 'svelte'
  import { t } from '../i18n.svelte'
  import { ADD_MARK } from './marks'
  import { addNote } from './add'
  import type { Kit } from './kit'

  const {
    kit,
    group,
    property,
    list = false,
    asked = 0,
    onmade,
  }: {
    kit: Kit
    group: Group
    /** The property the board groups by, which a new card is given its column's value of. */
    property: string | undefined
    /** Whether that property holds lists, so a new card holds a list of its column's one. */
    list?: boolean
    asked?: number
    /** A note made, by its path. */
    onmade?: (path: string) => void
  } = $props()

  let typing = $state(false)
  let words = $state('')
  let field = $state<HTMLInputElement>()
  /** A commit already on its way, so Enter and the blur after it do not make two. */
  let making = false

  $effect(() => {
    if (asked > 0) untrack(open)
  })

  function open() {
    typing = true
    queueMicrotask(() => field?.focus())
  }

  /** The value a new card of this column holds. */
  function valued(): Record<string, Value> {
    const key = group.key
    if (!property?.startsWith('note.') || key === null) return {}
    return { [property.slice(5)]: list ? [key] : key }
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
    try {
      const path = await addNote(
        base,
        kit.live.at,
        kit.file,
        property ? { property, key: group.key } : undefined,
        { title, open: false, properties: valued() },
      )
      if (path) onmade?.(path)
    } finally {
      making = false
    }
    if (again) field?.focus()
    else typing = false
  }
</script>

{#if typing}
  <div class="card">
    <input
      class="field"
      bind:this={field}
      bind:value={words}
      aria-label={t('New page')}
      placeholder={t('Untitled')}
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
    {t('New page')}
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
