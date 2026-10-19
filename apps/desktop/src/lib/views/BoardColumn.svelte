<script lang="ts">
  /** One column's cards, scrolling on their own, with only the cards on screen mounted:
   *  every card is one height, so where one sits is arithmetic (row-window.ts) and a
   *  column of two thousand costs the dozen a reader can see.
   *
   *  The card being carried stays mounted wherever the scroll goes, drawn at its own
   *  place out of the flow: the carry lives on it, and a card taken out of the page
   *  mid-carry would put the card back. */
  import { type Row, rowId } from '@nib/bases'
  import { untrack, type Snippet } from 'svelte'
  import { windowFor } from '../row-window'
  import { ListView } from '../row-window.svelte'
  import { dragging } from './drag.svelte'

  const {
    rows,
    height,
    card,
  }: {
    rows: readonly Row[]
    /** One card's height, gap included. */
    height: number
    card: Snippet<[Row, number]>
  } = $props()

  let list = $state<HTMLElement>()
  const win = new ListView()
  $effect(() => {
    const box = list
    if (!box) return
    const tall = height
    return untrack(() => win.follow(box, () => tall))
  })

  const keyOf = (row: Row) => `${row.space}:${rowId(row)}`

  /** Where the card being carried stands in this column, or -1. */
  const carried = $derived.by(() => {
    const row = dragging.row
    if (!row) return -1
    const key = keyOf(row)
    return rows.findIndex((one) => keyOf(one) === key)
  })

  const shown = $derived(
    windowFor({
      count: rows.length,
      height,
      top: win.top,
      room: win.room || 800,
      overscan: 4,
      pinned: carried === -1 ? [] : [carried],
    }),
  )

  /** The cards to draw: the window's, and the carried one held out of it, in one list
   *  in the column's order, so the held card is the same element when the window
   *  reaches it. */
  const drawn = $derived.by(() => {
    const out: { row: Row; index: number; away: boolean }[] = []
    for (let index = shown.first; index <= shown.last; index++) {
      const row = rows[index]
      if (row) out.push({ row, index, away: false })
    }
    for (const index of shown.pinned) {
      const row = rows[index]
      if (row) out.push({ row, index, away: true })
    }
    return out.sort((one, other) => one.index - other.index)
  })

  /** Scrolls the card at `index` into sight, for the keyboard landing on it. */
  export function reveal(index: number) {
    const box = scroller
    if (!box) return
    const top = index * height
    if (top < box.scrollTop) box.scrollTop = top
    else if (top + height > box.scrollTop + box.clientHeight)
      box.scrollTop = top + height - box.clientHeight
    // The window follows the scroll on its event, which comes after the keyboard has
    // looked for the card: read it now, so the card is mounted when it looks.
    win.refresh()
  }

  let scroller = $state<HTMLElement>()
</script>

<div class="scroll" bind:this={scroller}>
  <div
    class="cards"
    bind:this={list}
    style:padding-top="{shown.above}px"
    style:padding-bottom="{shown.below}px"
    style:--card={`${height}px`}
  >
    {#each drawn as one (keyOf(one.row))}
      <!-- A held card has no place among the window's, which is what data-index says. -->
      <div
        class="slot"
        class:away={one.away}
        style:top={one.away ? `${one.index * height}px` : undefined}
        data-index={one.away ? undefined : one.index}
      >
        {@render card(one.row, one.index)}
      </div>
    {/each}
  </div>
</div>

<style>
  .scroll {
    flex: 0 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 var(--space-2);
  }

  .cards {
    position: relative;
    min-height: var(--row-height);
  }

  .slot {
    height: var(--card);
  }

  .away {
    position: absolute;
    left: 0;
    right: 0;
  }
</style>
