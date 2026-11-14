<script lang="ts">
  import { cellValue, type Row } from '@orden/bases'
  import { linkModifier } from '@orden/editor'
  import { cardLine, type CardLine } from './board'
  import { toneColour, valueText } from './chips'
  import { draggable } from './drag.svelte'
  import type { Kit } from './kit'
  import { optionsAt } from './options'

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
    shown: readonly string[]
    checklist: { done: number; total: number } | undefined
    done: boolean
    pending?: boolean
    focused?: boolean
    carry?: boolean
    onmenu: (event: MouseEvent, row: Row) => void
    onfocus: () => void
  } = $props()

  const live = $derived(kit.live)
  const title = $derived(row.file.basename)
  const tone = $derived(live.colourOf(row))

  const values = $derived.by((): (CardLine | null)[] => {
    const base = live.base
    if (!base) return []
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

  const slots = $derived(Array.from({ length: lines.props }, (_, at) => values[at] ?? null))
  const ticked = $derived(checklist && checklist.total > 0 ? checklist : null)

  function keydown(event: KeyboardEvent) {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      const modded = event.ctrlKey || event.metaKey
      event.preventDefault()
      event.stopPropagation()
      kit.choose(row, modded)
    } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault()
      event.stopPropagation()
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
      <span class="name">{title || 'Untitled'}</span>
    </div>
    {#each slots as one, at (at)}
      {@render line(one, at === 0)}
    {/each}
  </div>
  <button
    type="button"
    class="orden-glyph menu"
    tabindex="-1"
    aria-label="More"
    title="More"
    onmousedown={(event) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.parentElement?.querySelector<HTMLElement>('[data-card]')?.focus({
        preventScroll: true,
      })
    }}
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
    -webkit-user-select: none;
    user-select: none;
  }

  @media (hover: hover) {
    .card:hover {
      border-color: var(--line-strong);
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

  .menu {
    position: absolute;
    top: 3px;
    inset-inline-end: 3px;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .card:hover .title,
  .card:focus-within .title,
  :global([data-touch]) .card .title {
    --under-menu: calc(var(--row-height-sm) + 3px);
    mask-image: linear-gradient(
      to left,
      transparent var(--under-menu),
      #000 calc(var(--under-menu) + var(--space-3))
    );
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
    width: var(--row-height-sm);
    height: var(--row-height-sm);
    opacity: 1;
  }

  .tinted {
    background: color-mix(in srgb, var(--row-tone) 14%, var(--bg));
  }
</style>
