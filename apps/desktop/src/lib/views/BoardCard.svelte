<script lang="ts">
  /** One card of a board, Notion's: the title clamped to the lines its size gives it,
   *  then a line per property the view shows, every line kept whether it holds anything
   *  or not, so every card of the view is one height (docs/design.md). A select's value
   *  is a pill in its option's tone, a list its first members and how many more, a date
   *  past in the danger tone unless the card is done. A note with task lines says how
   *  many are done; a task wears its box and its chips.
   *
   *  The card is one stop of the board's roving focus; its ⋯ beside it opens what the
   *  right button does. A card carried to another column and not written yet is drawn
   *  there already, a little faded. */
  import { cellValue, type Row } from '@nib/bases'
  import { linkModifier } from '@nib/editor'
  import { t } from '../i18n.svelte'
  import { priorityTone } from '../quick-add/labels'
  import { cardLine, type CardLine } from './board'
  import { chipsOf, toneColour, valueText } from './chips'
  import { draggable } from './drag.svelte'
  import { plain } from './inline'
  import type { Kit } from './kit'
  import { optionsAt } from './options'
  import TaskBox from './TaskBox.svelte'

  const {
    kit,
    row,
    lines,
    shown,
    checklist,
    done,
    pending = false,
    focused = false,
    carry = true,
    onmenu,
    onfocus,
  }: {
    kit: Kit
    row: Row
    lines: { title: number; props: number }
    /** The properties the view shows on its cards, in order. */
    shown: readonly string[]
    checklist: { done: number; total: number } | undefined
    /** In a done group: no date is late, and the title is quieter. */
    done: boolean
    pending?: boolean
    /** The card the board's focus is on, the one Tab reaches. */
    focused?: boolean
    /** Whether the card can be carried at all. */
    carry?: boolean
    onmenu: (event: MouseEvent, row: Row) => void
    onfocus: () => void
  } = $props()

  const live = $derived(kit.live)
  const title = $derived(row.task ? plain(row.task.text) : row.file.basename)
  const tone = $derived(live.colourOf(row))

  /** What each property line holds: the view's properties, as many as there are lines. */
  const values = $derived.by((): (CardLine | null)[] => {
    const base = live.base
    if (!base || row.task) return []
    return shown.slice(0, lines.props).map((property) => {
      const options = optionsAt(base, property)
      const optionTone = (value: string) => {
        const option = options.find((one) => one.value === value)
        return option ? toneColour(option.tone) : undefined
      }
      return cardLine(
        cellValue(base, property, row, live.context),
        optionTone,
        (value) => valueText(value, live.today),
        live.today,
        done,
      )
    })
  })

  /** The property lines, every one the size gives room for, filled or not. */
  const slots = $derived(Array.from({ length: lines.props }, (_, at) => values[at] ?? null))
  const ticked = $derived(checklist && checklist.total > 0 ? checklist : null)

  function keydown(event: KeyboardEvent) {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      kit.choose(row, event.ctrlKey || event.metaKey)
    } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault()
      const box =
        event.currentTarget instanceof HTMLElement && event.currentTarget.getBoundingClientRect()
      if (box)
        onmenu(new MouseEvent('contextmenu', { clientX: box.left + 12, clientY: box.bottom }), row)
    }
  }
</script>

{#snippet line(one: CardLine | null, last: boolean)}
  <div class="line">
    {#if one?.kind === 'pills'}
      {#each one.pills as pill, at (at)}
        <span class="tag" class:toned={pill.tone !== null} style:--pill={pill.tone}
          >{pill.text}</span
        >
      {/each}
      {#if one.more}<span class="more-count">+{one.more}</span>{/if}
    {:else if one}
      <span class="words" class:late={one.late}>{one.text}</span>
    {/if}
    {#if last && ticked}
      <span class="checklist" class:all={ticked.done === ticked.total}
        >{ticked.done}/{ticked.total}</span
      >
    {/if}
  </div>
{/snippet}

<div
  class="card"
  class:pending
  class:done
  class:tinted={tone !== null}
  style:--row-tone={tone}
  style:--tone={row.task ? priorityTone(row.task.priority) : null}
  style:--title-lines={lines.title}
  role="listitem"
>
  <div
    class="face"
    data-card
    role="button"
    tabindex={focused ? 0 : -1}
    aria-label={title}
    use:draggable={{ row, label: title, disabled: !carry }}
    onclick={(event) => kit.choose(row, linkModifier(event))}
    onkeydown={keydown}
    oncontextmenu={(event) => onmenu(event, row)}
    {onfocus}
  >
    <div class="title">
      {#if row.task}<TaskBox task={row.task} label={title} ontick={() => kit.tick(row)} />{/if}
      <span class="name">{title || t('Untitled')}</span>
    </div>
    {#if row.task}
      {#if lines.props}
        <div class="line">
          {#each chipsOf(row.task, live.today) as chip (chip.kind)}
            <span class="words chip" class:late={chip.late && !done}>{chip.text}</span>
          {/each}
          {#if kit.spec.builtin !== 'project'}<span class="where">{row.file.basename}</span>{/if}
        </div>
      {/if}
    {:else}
      {#each slots as one, at (at)}
        {@render line(one, at === 0)}
      {/each}
    {/if}
  </div>
  <button
    type="button"
    class="nib-glyph menu"
    tabindex="-1"
    aria-label={t('More')}
    title={t('More')}
    onclick={(event) => onmenu(event, row)}
  >
    <svg viewBox="0 0 13 13" aria-hidden="true"
      ><circle cx="3" cy="6.5" r="0.9" /><circle cx="6.5" cy="6.5" r="0.9" /><circle
        cx="10"
        cy="6.5"
        r="0.9"
      /></svg
    >
  </button>
</div>

<style>
  .card {
    position: relative;
    box-sizing: border-box;
    height: calc(100% - 6px);
    border: 1px solid var(--line);
    border-inline-start: 3px solid var(--tone, var(--line));
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    transition:
      border-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out),
      opacity var(--dur-fast) var(--ease-out);
  }

  .face {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 4px;
    height: 100%;
    padding: 7px var(--space-3);
    border-radius: inherit;
    outline: none;
    cursor: default;
  }

  @media (hover: hover) {
    .card:hover {
      border-color: var(--line-strong);
      border-inline-start-color: var(--tone, var(--line-strong));
      box-shadow: var(--shadow-sm);
    }
  }

  .card:has(:global(.is-carried)) {
    opacity: 0.35;
  }

  .pending {
    opacity: 0.7;
  }

  .title {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    min-width: 0;
    line-height: 19px;
  }

  .title :global(button) {
    margin-top: 2px;
  }

  .name {
    display: -webkit-box;
    min-width: 0;
    overflow: hidden;
    overflow-wrap: break-word;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: var(--title-lines);
    line-clamp: var(--title-lines);
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }

  .done .name {
    color: var(--muted-strong);
  }

  .line {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    height: 20px;
    min-width: 0;
    overflow: hidden;
    color: var(--muted);
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  .words {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chip {
    flex: none;
  }

  .late {
    color: var(--danger);
  }

  .tag {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--muted-strong);
    text-overflow: ellipsis;
  }

  /* An option's tone: a wash of it, and words in it deep enough to read on the wash. */
  .tag.toned {
    background: color-mix(in srgb, var(--pill) 16%, transparent);
    color: color-mix(in srgb, var(--pill) 62%, var(--text-strong));
  }

  .more-count,
  .checklist {
    flex: none;
    font-variant-numeric: tabular-nums;
  }

  .checklist {
    margin-inline-start: auto;
    padding-inline-start: var(--space-2);
  }

  .checklist.all {
    color: var(--success);
  }

  .where {
    margin-inline-start: auto;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .menu {
    position: absolute;
    top: 3px;
    inset-inline-end: 3px;
    opacity: 0;
    background: var(--surface);
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .menu svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: currentColor;
  }

  .card:hover .menu,
  .card:focus-within .menu {
    opacity: 1;
  }

  :global([data-touch]) .menu {
    opacity: 1;
  }

  /* The view's conditional colour (nib.colour), the row's tone over its ground. */
  .tinted {
    background: color-mix(in srgb, var(--row-tone) 14%, var(--bg));
  }
</style>
