<script lang="ts">
  import { midnightOf } from '../../platform/src/api'
  import { localDate } from '../../platform/src/api'
  import { DIVIDER, menu, type MenuEntry } from '../../ui-kit/src/api'
  import ActivityLayer from './ActivityLayer.svelte'
  import BlockEditor from './BlockEditor.svelte'
  import Chip from './Chip.svelte'
  import { daysAfter, MINUTE, ticking } from './days'
  import { edited } from './edit'
  import { clock, length } from './look'
  import type { Minute } from './minutes'
  import { type Row, daysOf } from './rows'
  import { mergeBlocks, placeBlock, rangeTotals, removeBlock, setActivity, splitBlock } from './schedule'
  import { Selection } from '../../tree/src/api'
  import { time } from './time.svelte'

  const {
    from,
    to,
    now,
    minutes,
    untracked,
    single = false,
    onmanage,
  }: {
    from: number
    to: number
    now: number
    minutes: readonly Minute[]
    untracked: boolean
    single?: boolean
    onmanage: () => void
  } = $props()
  interface Asking {
    anchor: HTMLElement
    chosen: string | null
    pick: (activity: string) => void
  }
  const STEP = 5 * MINUTE
  const days = $derived(daysOf(time.spans, minutes, from, to, now, untracked))
  const blocks = $derived(
    days.flatMap((one) =>
      one.rows.flatMap((row) => (row.kind === 'block' ? [{ day: one.day, id: row.span.id, row }] : [])),
    ),
  )
  const picking = new Selection()
  let open = $state(false)
  let asking = $state<Asking | null>(null)
  let list = $state<HTMLElement | null>(null)
  const order = $derived(blocks.map((one) => one.id))
  const only = $derived(picking.paths.length === 1 ? (picking.paths[0] ?? null) : null)
  const totalOf = (day: number) => rangeTotals(time.spans, minutes, day, daysAfter(day, 1), now, { untracked }).ms
  const round = (at: number) => Math.round(at / STEP) * STEP
  $effect(() => {
    const live = order
    if (picking.paths.some((id) => !live.includes(id))) picking.keepOnly((id) => live.includes(id))
  })
  function neighbours(id: string): { before: string | null; after: string | null } {
    const at = blocks.findIndex((one) => one.id === id)
    const here = blocks[at]
    const same = (one: (typeof blocks)[number] | undefined) => (one && one.day === here?.day ? one.id : null)
    return { before: same(blocks[at - 1]), after: same(blocks[at + 1]) }
  }
  function choose(id: string | null, editing = true) {
    if (id === null) picking.clear()
    else picking.select(id)
    open = id !== null && editing
  }
  function clicked(event: MouseEvent, id: string) {
    if (event.shiftKey) picking.range(id, order)
    else if (event.metaKey || event.ctrlKey) picking.toggle(id)
    else {
      const again = only === id && open
      choose(again ? null : id)
      return
    }
    open = false
  }
  function ask(anchor: EventTarget | null, chosen: string | null, pick: (activity: string) => void) {
    if (!(anchor instanceof HTMLElement)) return
    asking = asking?.anchor === anchor ? null : { anchor, chosen, pick }
  }
  function changeOf(id: string, anchor: EventTarget | null) {
    ask(anchor, time.span(id)?.activity ?? null, (activity) =>
      edited(setActivity(time.spans, id, activity), 'scheduled'),
    )
  }
  function fill(anchor: EventTarget | null, start: number, end: number) {
    ask(anchor, null, (activity) => {
      const id = crypto.randomUUID()
      edited(placeBlock(time.spans, start, end, activity, now, id), 'scheduled')
      choose(id, false)
    })
  }
  function addAfter(anchor: EventTarget | null, day: number, rows: readonly Row[]) {
    const last = [...rows].reverse().find((one) => one.kind === 'block')
    const today = day === midnightOf(now)
    const end =
      today && !last
        ? round(now)
        : Math.min(round((last?.to ?? day + 9 * 60 * MINUTE) + 30 * MINUTE), daysAfter(day, 1))
    const start = today && !last ? end - 30 * MINUTE : (last?.to ?? end - 30 * MINUTE)
    fill(anchor, start, Math.max(end, start + STEP))
  }
  function split(id: string) {
    const span = time.span(id)
    if (!span) return
    const end = span.end ?? now
    const at = round(span.start + (end - span.start) / 2)
    edited(splitBlock(time.spans, id, at, now), 'scheduled')
    choose(id)
  }
  function adjacent(ids: readonly string[]): string[] | null {
    const at = ids.map((id) => order.indexOf(id)).sort((one, other) => one - other)
    if (at.length < 2 || at.some((one, index) => index > 0 && one !== (at[index - 1] ?? 0) + 1)) return null
    const run = at.map((index) => blocks[index])
    return run.every((one) => one?.day === run[0]?.day) ? run.map((one) => one?.id ?? '') : null
  }
  function merge(id: string, other: string | null) {
    if (other === null) return
    edited(mergeBlocks(time.spans, id, other, now), 'moved')
  }
  function mergeAll(ids: readonly string[]) {
    const run = adjacent(ids)
    const first = run?.[0]
    const last = run?.at(-1)
    if (!first || !last) return
    edited(mergeBlocks(time.spans, first, last, now), 'moved')
    choose(first, false)
  }
  function remove(ids: readonly string[]) {
    if (!ids.length) return
    const at = ids.reduce((most, id) => Math.max(most, order.indexOf(id)), -1)
    const next = order.slice(at + 1).find((id) => !ids.includes(id)) ?? null
    edited(
      ids.flatMap((id) => removeBlock(time.spans, id)),
      'deleted',
    )
    choose(next, false)
  }
  function rowMenu(event: MouseEvent, id: string) {
    event.preventDefault()
    if (!picking.has(id)) choose(id, false)
    const many = picking.paths.length > 1 ? [...picking.paths] : null
    if (many) {
      const run = adjacent(many)
      menu.show(
        event,
        [
          ...(run ? [{ label: `Merge ${String(run.length)} blocks`, run: () => mergeAll(run) }] : []),
          ...(run ? [DIVIDER] : []),
          { label: `Delete ${String(many.length)} blocks`, danger: true, run: () => remove(many) },
        ],
        { title: `${String(many.length)} blocks` },
      )
      return
    }
    const { before, after } = neighbours(id)
    const anchor = list?.querySelector(`[data-time-block="${CSS.escape(id)}"] [data-time-chip]`) ?? null
    const items: MenuEntry[] = [
      { label: 'Change activity', run: () => changeOf(id, anchor) },
      { label: 'Split', run: () => split(id) },
      ...(before ? [{ label: 'Merge with previous', run: () => merge(id, before) }] : []),
      ...(after ? [{ label: 'Merge with next', run: () => merge(id, after) }] : []),
      DIVIDER,
      { label: 'Delete', danger: true, run: () => remove([id]) },
    ]
    menu.show(event, items, { title: 'Block' })
  }
  function focusOn(id: string) {
    list?.querySelector<HTMLElement>(`[data-time-block="${CSS.escape(id)}"] .body`)?.focus()
  }
  function keyed(event: KeyboardEvent) {
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) return
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const current = only ?? picking.paths.at(-1) ?? null
    const at = current === null ? -1 : order.indexOf(current)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = order[Math.max(0, Math.min(order.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))]
      if (!next) return
      if (event.shiftKey && current !== null) picking.extend(current, next, order)
      else choose(next, open)
      focusOn(next)
    } else if (event.key === 'Enter' && only !== null) {
      event.preventDefault()
      open = !open
    } else if (event.key === 'Escape' && picking.paths.length) {
      event.preventDefault()
      if (open) open = false
      else choose(null)
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && picking.paths.length) {
      event.preventDefault()
      remove([...picking.paths])
    }
  }
  const dayName = (day: number) => localDate(day, { weekday: 'long', day: 'numeric', month: 'long' })
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="blocks" bind:this={list} onkeydown={keyed} data-time-blocks>
  {#if !days.length}
    <p class="empty">Nothing tracked in this range</p>
  {/if}
  {#each days as one (one.day)}
    {@const last = one.rows.at(-1)}
    <section class="day" data-time-day={one.day}>
      {#if !single}
        <h3 class="head">
          <span>{dayName(one.day)}</span>
          <span class="total">{length(totalOf(one.day))}</span>
        </h3>
      {/if}
      <div class="rows">
        {#each one.rows as row (`${row.kind}-${row.from}-${row.kind === 'block' ? row.span.id : ''}`)}
          {#if row.kind === 'block'}
            {@const id = row.span.id}
            {@const running = row.span.end === null}
            <div class="line">
              <span class="clock">{clock(row.from)}</span>
              <div
                class="block"
                class:on={picking.has(id)}
                class:running
                data-time-block={id}
                oncontextmenu={(event) => rowMenu(event, id)}
              >
                <Chip activity={row.span.activity} onclick={(event: MouseEvent) => changeOf(id, event.currentTarget)} />
                <button
                  type="button"
                  class="body"
                  aria-pressed={picking.has(id)}
                  aria-expanded={only === id && open}
                  onclick={(event) => clicked(event, id)}
                >
                  <span class="long">{running ? ticking(now - row.from) : length(row.to - row.from)}</span>
                </button>
                <button
                  type="button"
                  class="orden-glyph more"
                  aria-label="More"
                  title="More"
                  aria-haspopup="menu"
                  onclick={(event) => rowMenu(event, id)}>⋯</button
                >
              </div>
            </div>
            {#if only === id && open}
              {@const near = neighbours(id)}
              <BlockEditor
                span={row.span}
                {now}
                hasBefore={near.before !== null}
                hasAfter={near.after !== null}
                onsplit={() => split(id)}
                onmerge={(which: 'before' | 'after') => merge(id, which === 'before' ? near.before : near.after)}
                ondelete={() => remove([id])}
                onclose={() => (open = false)}
              />
            {/if}
          {:else if row.kind === 'unset'}
            <div class="line">
              <span class="clock">{clock(row.from)}</span>
              <div class="block unset" data-time-unset>
                <span class="word">Not set</span>
                <button
                  type="button"
                  class="orden-chip choose"
                  onclick={(event) => fill(event.currentTarget, row.from, row.to)}>Choose activity</button
                >
                <span class="long">{length(row.to - row.from)}</span>
              </div>
            </div>
          {:else if row.kind === 'gap'}
            <div class="line gap">
              <span class="clock">{clock(row.from)}</span>
              <button
                type="button"
                class="add-gap"
                data-time-gap
                onclick={(event) => fill(event.currentTarget, row.from, row.to)}><span>+ Add</span></button
              >
            </div>
          {:else}
            <div class="line night" aria-hidden="true"><span class="clock"></span><span class="hair"></span></div>
          {/if}
        {/each}
        {#if last}
          <div class="line end">
            <span class="clock">{last.kind === 'block' && last.span.end === null ? 'now' : clock(last.to)}</span>
          </div>
        {/if}
        <button
          type="button"
          class="orden-row is-short is-quiet add"
          data-time-add
          onclick={(event) => addAfter(event.currentTarget, one.day, one.rows)}>+ Add block</button
        >
      </div>
    </section>
  {/each}
</div>
{#if asking}
  <ActivityLayer
    from={asking.anchor}
    chosen={asking.chosen}
    onpick={asking.pick}
    {onmanage}
    onclose={() => (asking = null)}
  />
{/if}

<style>
  .blocks {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
    padding-top: var(--space-2);
  }
  .empty {
    margin: var(--space-4) 0;
    color: var(--muted);
    text-align: center;
  }
  .head {
    position: sticky;
    top: 0;
    z-index: var(--z-raised);
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin: 0 0 var(--space-2);
    padding: var(--space-2) 0;
    background: var(--bg);
    color: var(--text-strong);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
  }
  .total {
    font-variant-numeric: tabular-nums;
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .line {
    display: grid;
    grid-template-columns: 3.5rem minmax(0, 1fr);
    align-items: start;
    min-width: 0;
  }
  .clock {
    padding-top: 2px;
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    translate: 0 -0.55em;
  }
  .block {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    min-height: 44px;
    padding: 0 var(--space-2) 0 var(--space-3);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    cursor: default;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }
  @media (hover: hover) {
    .block:hover {
      background: var(--surface-hover);
    }
    .block:hover .more {
      opacity: 1;
    }
  }
  .block.on {
    border-color: var(--accent);
  }
  :global([data-touch]) .block {
    min-height: var(--touch-row);
  }
  .body {
    display: flex;
    flex: 1;
    align-self: stretch;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    cursor: default;
  }
  .long {
    color: var(--muted-strong);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }
  .running .long {
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }
  .more {
    flex: none;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }
  .block.on .more {
    opacity: 1;
  }
  .unset {
    border: 1px dashed var(--line-strong);
    background: none;
    box-shadow: none;
  }
  .unset .long {
    margin-inline-start: auto;
  }
  .word {
    color: var(--muted);
    font-size: var(--text-sm);
  }
  .choose {
    flex: none;
  }
  .gap .clock {
    translate: 0 -0.55em;
  }
  .add-gap {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: transparent;
    font: inherit;
    font-size: var(--text-xs);
    cursor: default;
  }
  @media (hover: hover) {
    .add-gap:hover {
      background: var(--surface-hover);
      color: var(--muted-strong);
    }
  }
  .add-gap:focus-visible {
    color: var(--muted-strong);
  }
  .night .hair {
    height: 1px;
    margin: 4px 0;
    background: var(--line);
  }
  .end {
    min-height: 0;
  }
  .add {
    margin-top: var(--space-1);
    margin-inline-start: 3.5rem;
    width: auto;
    color: var(--muted);
  }
</style>
