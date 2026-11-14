<script lang="ts">
  import { keyElsewhere } from '../layer-keys'
  import {
    type Answer,
    groupName,
    type Group,
    orderId,
    type Row,
    rowId,
    type Value,
    isWhen,
  } from '@orden/bases'
  import { tick, untrack } from 'svelte'
  import { menu, type MenuEntry } from '../menu.svelte'
  import { viewport } from '../ui-kit/src/api'
  import { asOneUndo, dropRow } from './act'
  import AddRow from './AddRow.svelte'
  import {
    cardHeight,
    cardKey,
    cardLines,
    cardProperties,
    checklists,
    sizeOf,
    droppableBy,
    indexWithout,
    isDoneGroup,
    mergedOrder,
    nextLaned,
    noteKey,
    orderAfter,
    type Pending,
    withOrder,
    withPending,
  } from './board'
  import BoardCard from './BoardCard.svelte'
  import BoardColumn from './BoardColumn.svelte'
  import BoardHead from './BoardHead.svelte'
  import BoardNew from './BoardNew.svelte'
  import { cardEntries, columnEntries, optionFor, renameOption } from './board-menus'
  import { toneColour, valueText } from './chips'
  import { editorOf, displayName } from './columns'
  import { dragging, droppable, placeAmong, type Point } from './drag.svelte'
  import { drawer, rightDrawer } from '../drawer.svelte'
  import { claimsGesture, isFinger } from '../swipe'
  import { type Drop, dropInto } from './drop'
  import {
    placeColumn,
    prunedOrder,
    setHidden,
    setManualOrder,
    setProperty,
    setSort,
    setSummary,
  } from './edit'
  import { failed } from './failed.svelte'
  import { laneKeys, withEveryDay, withinDays } from './list-items'
  import type { Kit } from './kit'
  import { holdsLists, optionsAt } from './options'
  import { dayHead, groupLabel, noteNames, propertyName, summaryName } from './words'
  import { reorderDrag } from './reorder-drag'
  import { ADD_MARK } from './marks'
  import { focusSoon } from './focus-soon'

  const {
    kit,
    days,
    adding = 0,
  }: {
    kit: Kit
    days?: { from: string; through: string } | undefined
    adding?: number
  } = $props()

  const live = $derived(kit.live)
  const view = $derived(live.view)
  const base = $derived(live.base)
  const property = $derived(view?.groupBy?.property)
  const sub = $derived(view?.orden.subGroupBy?.property)
  const hidden = $derived(view?.orden.hidden ?? [])
  const kinds = $derived(view?.orden.rows ?? 'notes')
  const notes = $derived(kinds === 'notes')
  const pages = $derived(kit.adds)
  const grows = $derived(!kit.compact && kit.writable)
  const sorted = $derived((view?.sort.length ?? 0) > 0)
  const carries = $derived(droppableBy(property, kinds))
  const coloured = $derived(view?.orden.colourColumns !== false)
  const phone = $derived(viewport.device === 'phone')
  const options = $derived(base && property ? optionsAt(base, property) : [])
  const lists = $derived(property?.startsWith('note.') ? holdsLists(live.rows, property) : false)

  let pending = $state<Pending[]>([])
  let shuffled = $state<{ column: string; order: string[] } | null>(null)

  const answered = $derived(
    days
      ? withinDays(
          withEveryDay(live.answer?.groups ?? [], days.from, days.through),
          days.from,
          days.through,
        )
      : (live.answer?.groups ?? []),
  )
  const groups = $derived.by(() => {
    const placed = withPending(answered, pending)
    return shuffled ? withOrder(placed, shuffled.column, shuffled.order, orderId) : placed
  })
  const shownGroups = $derived(
    groups.filter(
      (group) =>
        !hidden.includes(groupName(group.key)) &&
        !(view?.orden.hideEmpty && group.rows.length === 0),
    ),
  )
  const hiddenGroups = $derived(groups.filter((group) => hidden.includes(groupName(group.key))))
  const names = $derived(shownGroups.map((group) => groupName(group.key)))

  let seen: Answer | null = null
  $effect(() => {
    const answer = live.answer
    if (answer === seen) return
    seen = answer
    untrack(() => {
      if (pending.some((one) => one.written)) pending = pending.filter((one) => !one.written)
      shuffled = null
    })
  })

  const lanes = $derived(sub === undefined ? [] : laneKeys(shownGroups))
  const noteCounts = $derived(noteNames(groups.map((one) => one.key)))
  const laneNames = $derived(noteNames(lanes))
  const walked = $derived<(Value | undefined)[]>(lanes.length ? lanes : [undefined])
  const laneLists = $derived(sub?.startsWith('note.') ? holdsLists(live.rows, sub) : false)

  const laneOf = (lane: string | null): Value | undefined =>
    lane === null ? undefined : lanes.find((one) => groupName(one) === lane)

  const placeKey = (column: string, lane: string | null) =>
    lane === null ? column : `${column}\n${lane}`

  const placeSelector = (column: string, lane: string | null) =>
    `[data-column="${CSS.escape(column)}"]` +
    (lane === null ? '' : `[data-lane="${CSS.escape(lane)}"]`)

  const shown = $derived(cardProperties(live.columns, property, sub))
  const checked = $derived(checklists(live.rows))
  const anyChecklist = $derived(
    shownGroups.some((group) => group.rows.some((row) => checked.has(noteKey(row)))),
  )
  const lines = $derived(
    cardLines(
      sizeOf(view?.orden.cardSize, notes),
      notes ? shown.length : 0,
      !notes || anyChecklist,
    ),
  )
  const height = $derived(cardHeight(lines, viewport.touch))

  const nothing = $derived(
    property && !days
      ? `No ${propertyName(property, base ? displayName(base, property) : undefined)}`
      : 'None',
  )

  function columnName(group: Group): string {
    if (days) return dayHead(group.key, live.today)
    if (isWhen(property)) return groupLabel(property, group.key, live.today)
    if (group.key === null || group.key === '') return nothing
    return groupLabel(property, group.key, live.today, noteCounts)
  }

  function toneOfGroup(group: Group): string | null {
    if (!coloured) return null
    const key = group.key
    if (isWhen(property))
      return key === 'overdue'
        ? 'var(--danger)'
        : key === 'today'
          ? 'var(--success)'
          : key === 'tomorrow'
            ? 'var(--canvas-2)'
            : key === 'later'
              ? 'var(--canvas-6)'
              : null
    return toneColour(optionFor(base, property ?? '', key)?.tone)
  }

  function unlisted(group: Group): boolean {
    const key = group.key
    return (
      options.length > 0 &&
      typeof key === 'string' &&
      key !== '' &&
      !options.some((one) => one.value === key)
    )
  }

  let renaming = $state<string | null>(null)

  function moveColumn(name: string, step: -1 | 1) {
    const at = names.indexOf(name)
    const target = names[at + step]
    if (at === -1 || target === undefined) return
    kit.change((one, view) => placeColumn(one, view, names, name, target, step > 0))
  }

  function columnMenu(event: MouseEvent, group: Group) {
    const name = groupName(group.key)
    const hide = {
      label: 'Hide',
      run: () => kit.change((one, at) => setHidden(one, at, name, true)),
    }
    if (!property || days) {
      menu.show(event, [hide], { title: columnName(group) })
      return
    }
    menu.show(
      event,
      columnEntries({
        kit,
        event,
        property,
        group,
        name: columnName(group),
        option: optionFor(base, property, group.key),
        unlisted: unlisted(group),
        names,
        rename: () => (renaming = name),
        move: (step) => moveColumn(name, step),
      }),
      { title: columnName(group) },
    )
  }

  function countMenu(event: MouseEvent) {
    if (!base) return
    const summaries = view?.summaries ?? {}
    const offered = shown.flatMap((one): MenuEntry[] => {
      const kind = editorOf(base, one, live.rows)
      const names =
        kind === 'number'
          ? ['Sum', 'Average', 'Min', 'Max']
          : kind === 'date'
            ? ['Earliest', 'Latest']
            : kind === 'checkbox'
              ? ['Checked']
              : []
      const label = propertyName(one, displayName(base, one))
      return names.map((summary) => ({
        label: `${label}: ${summaryName(summary)}`,
        checked: summaries[one] === summary,
        run: () =>
          kit.change((next, at) =>
            setSummary(next, at, one, summaries[one] === summary ? null : summary),
          ),
      }))
    })
    menu.show(
      event,
      [
        {
          label: 'Count',
          checked: !Object.keys(summaries).length,
          run: () =>
            kit.change((next, at) =>
              Object.keys(summaries).reduce((one, key) => setSummary(one, at, key, null), next),
            ),
        },
        ...offered,
      ],
      { title: 'Calculate' },
    )
  }

  function sumsOf(group: Group): string[] {
    return Object.keys(view?.summaries ?? {})
      .map((one) => valueText(group.summaries[one] ?? null, live.today))
      .filter(Boolean)
  }

  let pickedFrom: { column: string; lane: string | null } | null = null

  function indexAt(place: HTMLElement, at: Point): number {
    const slots = [...place.querySelectorAll<HTMLElement>('[data-index]')]
    const found = placeAmong(slots, at)
    const first = Number(slots[0]?.dataset.index ?? 0)
    return slots.length ? first + found : 0
  }

  function rowsOf(group: Group, laneKey: Value | undefined): readonly Row[] {
    if (laneKey === undefined) return group.rows
    return group.sub?.find((one) => groupName(one.key) === groupName(laneKey))?.rows ?? []
  }

  function holds(where: { column: string; lane: string | null }, row: Row): boolean {
    const group = groups.find((one) => groupName(one.key) === where.column)
    const key = cardKey(row)
    return !!group && rowsOf(group, laneOf(where.lane)).some((one) => cardKey(one) === key)
  }

  function whereIs(row: Row, given?: string): { column: string; lane: string | null } {
    const column = given ?? columnOf(row) ?? ''
    const group = groups.find((one) => groupName(one.key) === column)
    const key = cardKey(row)
    const lane = group?.sub?.find((one) => one.rows.some((each) => cardKey(each) === key))
    return { column, lane: lane ? groupName(lane.key) : null }
  }

  function land(row: Row, group: Group, laneKey: Value | undefined, at: Point, place: HTMLElement) {
    const key = cardKey(row)
    const was = rowsOf(group, laneKey).findIndex((one) => cardKey(one) === key)
    carryTo(row, group, laneKey, indexWithout(indexAt(place, at), was), at)
  }

  function inTurn(drops: readonly (Drop | null)[]): Drop[] {
    const given = drops.filter((one): one is Drop => one !== null)
    const changes = given.flatMap((one) => ('change' in one ? [one.change] : []))
    const change: Drop[] = changes.length
      ? [
          {
            change: changes.reduce((one, next) => ({
              note: { ...one.note, ...next.note },
            })),
          },
        ]
      : []
    return [
      ...change,
      ...given.filter((one) => 'tick' in one),
      ...given.filter((one) => 'move' in one),
    ]
  }

  function carryTo(
    row: Row,
    group: Group,
    laneKey: Value | undefined,
    index: number,
    at: Point | null,
  ) {
    const by = property
    if (by === undefined) return
    const name = groupName(group.key)
    const picked = pickedFrom && holds(pickedFrom, row) ? pickedFrom : null
    pickedFrom = null
    const from =
      picked && (picked.lane !== null || sub === undefined) ? picked : whereIs(row, picked?.column)
    const toLane = laneKey ?? (sub === undefined ? undefined : laneOf(from.lane))
    const lane = toLane === undefined ? null : groupName(toLane)
    const ids = rowsOf(group, toLane).map(orderId)
    const id = orderId(row)
    const laneOrder = orderAfter(ids, id, index)
    const order = toLane === undefined ? laneOrder : mergedOrder(group.rows.map(orderId), laneOrder)

    if (from.column === name && (lane === null || from.lane === lane)) {
      if (laneOrder.join('\n') === ids.join('\n')) return
      reorder(name, order, at)
      return
    }
    if (!carries) return

    const fromKey = groups.find((one) => groupName(one.key) === from.column)?.key
    const first = from.column === name ? null : dropInto(by, group.key, row, fromKey)
    const second =
      toLane !== undefined && sub !== undefined && from.lane !== lane
        ? dropInto(sub, toLane, row, laneOf(from.lane))
        : null
    const drops = inTurn([first, second])
    if (!drops.length) return

    const card = cardKey(row)
    const moving: Pending = {
      card,
      row,
      from: from.column,
      to: name,
      key: group.key,
      ...(from.lane === null ? {} : { fromLane: from.lane }),
      ...(toLane === undefined ? {} : { lane: toLane }),
      index,
    }
    pending = [...pending.filter((one) => one.card !== card), moving]
    announce(`${titleOf(row)} moved to ${columnName(group)}`)
    const others = ids.filter((one) => one !== id).length
    const stored = (view?.orden.order?.[name]?.length ?? 0) > 0
    const keepOrder = !sorted && (stored || index < others)

    const write = async () => {
      let wrote = false as boolean
      const before = live.answer
      await asOneUndo([
        ...drops.map((drop) => async () => (wrote = await dropRow(row, drop))),
        () => (wrote && keepOrder ? writeOrder(name, order) : Promise.resolve(false)),
      ])
      if (wrote) {
        pending =
          live.answer === before
            ? pending.map((one) => (one === moving ? { ...one, written: true } : one))
            : pending.filter((one) => one !== moving)
      } else {
        pending = pending.filter((one) => one !== moving)
        failed.tell(() => {
          pickedFrom = from
          carryTo(row, group, laneKey, index, null)
        })
      }
    }
    void write()
  }

  function writeOrder(name: string, order: string[], unsorted = false): Promise<boolean> {
    const alive = new Set(live.rows.flatMap((row) => [orderId(row), rowId(row)]))
    return kit.changed((one, view) =>
      prunedOrder(
        setManualOrder(unsorted ? setSort(one, view, []) : one, view, name, order),
        view,
        name,
        (id) => alive.has(id),
      ),
    )
  }

  function reorder(name: string, order: string[], at: Point | null) {
    if (!sorted) {
      shuffle(name, order, false)
      return
    }
    const where = at ?? { x: 0, y: 0 }
    menu.show(
      new MouseEvent('contextmenu', { clientX: where.x, clientY: where.y }),
      [
        {
          label: 'Remove sort',
          run: () => shuffle(name, order, true),
        },
        { label: 'Cancel', run: () => undefined },
      ],
      { title: 'Remove sort?' },
    )
  }

  function shuffle(name: string, order: string[], unsorted: boolean) {
    const mine = { column: name, order }
    shuffled = mine
    void writeOrder(name, order, unsorted).then((wrote) => {
      if (!wrote && shuffled === mine) shuffled = null
    })
  }

  function columnOf(row: Row): string | null {
    const key = cardKey(row)
    const found = shownGroups.find((group) => group.rows.some((one) => cardKey(one) === key))
    return found ? groupName(found.key) : null
  }

  const titleOf = (row: Row) => row.file.basename

  let said = $state('')
  function announce(words: string) {
    said = words
  }

  function cardMenu(event: MouseEvent, row: Row, from: string) {
    const here = from
    menu.show(
      event,
      cardEntries({
        kit,
        event,
        row,
        targets: carries
          ? [...shownGroups, ...hiddenGroups].map((group) => ({
              key: group.key,
              name: columnName(group),
              here: groupName(group.key) === here,
            }))
          : [],
        move: (key) => {
          const group = groups.find((one) => groupName(one.key) === groupName(key))
          if (!group) return
          pickedFrom = { column: here, lane: null }
          carryTo(row, group, undefined, group.rows.length, null)
        },
      }),
      { title: titleOf(row) },
    )
  }

  let focus = $state<{ column: string; lane: string | null; card: string } | null>(null)
  const columns: Record<string, { reveal: (index: number) => void } | undefined> = {}
  let asked = $state<Record<string, number>>({})

  function askNew(column: string, lane: string | null) {
    const key = placeKey(column, lane)
    asked = { ...asked, [key]: (asked[key] ?? 0) + 1 }
  }

  const rover = $derived.by(() => {
    if (focus) {
      const at = focus
      const group = shownGroups.find((one) => groupName(one.key) === at.column)
      if (group && rowsOf(group, laneOf(at.lane)).some((one) => cardKey(one) === at.card)) return at
    }
    const columnsShown = phone && !lanes.length && phoneColumn ? [phoneColumn] : shownGroups
    for (const laneKey of walked) {
      for (const group of columnsShown) {
        const first = rowsOf(group, laneKey)[0]
        if (first)
          return {
            column: groupName(group.key),
            lane: laneKey === undefined ? null : groupName(laneKey),
            card: cardKey(first),
          }
      }
    }
    return null
  })

  function isFocus(column: string, lane: string | null, row: Row): boolean {
    return rover?.column === column && rover.lane === lane && rover.card === cardKey(row)
  }

  async function focusAt(column: number, lane: number, index: number) {
    const group = shownGroups[column]
    if (!group) return
    const laneKey = walked[lane]
    const row = rowsOf(group, laneKey)[index]
    const name = groupName(group.key)
    if (!row) {
      await tick()
      const laneName = laneKey === undefined ? null : groupName(laneKey)
      board?.querySelector<HTMLElement>(`${placeSelector(name, laneName)} [data-new-page]`)?.focus()
      return
    }
    await focusCard(name, laneKey, row)
  }

  async function focusCard(name: string, laneKey: Value | undefined, row: Row) {
    await tick()
    const group = shownGroups.find((one) => groupName(one.key) === name)
    const card = cardKey(row)
    const index = group ? rowsOf(group, laneKey).findIndex((one) => cardKey(one) === card) : -1
    if (index === -1) return
    const lane = laneKey === undefined ? null : groupName(laneKey)
    focus = { column: name, lane, card }
    columns[placeKey(name, lane)]?.reveal(index)
    await tick()
    board
      ?.querySelector<HTMLElement>(
        `${placeSelector(name, lane)} [data-index="${index}"] [data-card]`,
      )
      ?.focus()
  }

  let board = $state<HTMLElement>()

  function keydown(event: KeyboardEvent & { currentTarget: HTMLElement }) {
    if (event.defaultPrevented || keyElsewhere(event, event.currentTarget)) return
    const face = event.target instanceof HTMLElement ? event.target.closest('[data-card]') : null
    const columnBox = face?.closest<HTMLElement>('[data-column]')
    const slot = face?.closest<HTMLElement>('[data-index]')
    if (!face || !columnBox || !slot) return
    const name = columnBox.dataset.column ?? ''
    const laneName = columnBox.dataset.lane ?? null
    const column = names.indexOf(name)
    const lane = laneName === null ? 0 : lanes.findIndex((one) => groupName(one) === laneName)
    const laneKey = walked[lane]
    const index = Number(slot.dataset.index)
    const group = shownGroups[column]
    const rows = group ? rowsOf(group, laneKey) : []
    const row = rows[index]
    if (!group || !row || lane === -1) return
    const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'] as const
    const arrow = arrows.find((one) => one === event.key)

    if (arrow && event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault()
      if (arrow === 'ArrowLeft' || arrow === 'ArrowRight') {
        const to = shownGroups[column + (arrow === 'ArrowLeft' ? -1 : 1)]
        if (!to || !carries) return
        pickedFrom = { column: name, lane: laneName }
        carryTo(row, to, laneKey, Math.min(index, rowsOf(to, laneKey).length), null)
        void focusCard(groupName(to.key), laneKey, row)
      } else if (arrow === 'ArrowUp' || arrow === 'ArrowDown') {
        const next = index + (arrow === 'ArrowUp' ? -1 : 1)
        if (next < 0 || next >= rows.length) return
        const order = orderAfter(rows.map(orderId), orderId(row), next)
        reorder(
          name,
          laneKey === undefined ? order : mergedOrder(group.rows.map(orderId), order),
          null,
        )
        if (!sorted) void focusCard(name, laneKey, row)
      }
      return
    }
    if (arrow && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault()
      const counts = walked.map((one) => shownGroups.map((each) => rowsOf(each, one).length))
      const next = nextLaned(counts, { lane, column, index }, arrow)
      if (next) void focusAt(next.column, next.lane, next.index)
      return
    }
  }

  let showing = $state<string | null>(null)
  const phoneColumn = $derived(
    shownGroups.find((group) => groupName(group.key) === showing) ?? shownGroups[0],
  )

  let swipeFrom: { x: number; y: number; id: number } | null = null
  function swipeStart(event: PointerEvent) {
    swipeFrom = isFinger(event.pointerType)
      ? { x: event.clientX, y: event.clientY, id: event.pointerId }
      : null
  }
  function swipeEnd(event: PointerEvent) {
    const from = swipeFrom
    swipeFrom = null
    if (from?.id !== event.pointerId || dragging.row) return
    if (drawer.held || rightDrawer.held) return
    const dx = event.clientX - from.x
    const dy = event.clientY - from.y
    if (Math.abs(dx) < 64 || !claimsGesture(dx, dy)) return
    const at = phoneColumn ? shownGroups.indexOf(phoneColumn) : -1
    const forward = dx < 0
    const next = shownGroups[at + (forward ? 1 : -1)]
    if (next) showing = groupName(next.key)
  }

  let addingSeen = untrack(() => adding)
  $effect(() => {
    if (adding <= addingSeen) return
    addingSeen = adding
    const first = untrack(() => (phone ? phoneColumn : shownGroups[0]))
    if (!first) return
    const lane = untrack(() => lanes[0])
    untrack(() => askNew(groupName(first.key), lane === undefined ? null : groupName(lane)))
  })

  let naming = $state(false)
  function addGroup(words: string) {
    const value = words.trim()
    naming = false
    if (!value || !property || !base) return
    if (options.some((one) => one.value === value)) return
    kit.change((one) =>
      setProperty(one, property.replace(/^note\./, ''), {
        options: [...options, { value, tone: String((options.length % 6) + 1) }],
      }),
    )
  }
  const groupable = $derived(!days && grows && property?.startsWith('note.') === true)
</script>

{#snippet card(row: Row, group: Group, lane: string | null)}
  {@const column = groupName(group.key)}
  <BoardCard
    {kit}
    {row}
    {lines}
    {shown}
    checklist={checked.get(noteKey(row))}
    done={isDoneGroup(base, property, group.key)}
    pending={pending.some((one) => one.card === cardKey(row) && !one.written)}
    focused={isFocus(column, lane, row)}
    carry={carries || !sorted}
    onmenu={(event: MouseEvent, one: Row) => cardMenu(event, one, column)}
    onfocus={() => (focus = { column, lane, card: cardKey(row) })}
  />
{/snippet}

{#snippet head(group: Group)}
  {@const name = groupName(group.key)}
  {#if renaming === name}
    <div class="head-field">
      <input
        class="orden-field"
        value={name}
        aria-label="Rename"
        onkeydown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            renaming = null
          }
        }}
        onblur={(event) => {
          const words = event.currentTarget.value
          if (renaming === name && property) renameOption(kit, property, name, words)
          renaming = null
        }}
        use:focusSoon
      />
    </div>
  {:else}
    <div
      use:reorderDrag={{
        id: name,
        among: 'column',
        across: true,
        place: (moving, target, after) =>
          kit.change((one, at) => placeColumn(one, at, names, moving, target, after)),
      }}
    >
      <BoardHead
        name={columnName(group)}
        tone={toneOfGroup(group)}
        count={group.rows.length}
        sums={sumsOf(group)}
        muted={unlisted(group)}
        circle={!notes}
        canAdd={pages}
        onmenu={(event: MouseEvent) => columnMenu(event, group)}
        oncount={countMenu}
        onadd={() =>
          notes
            ? askNew(name, lanes[0] === undefined ? null : groupName(lanes[0]))
            : kit.add(property ? { property, key: group.key } : undefined)}
      />
    </div>
  {/if}
{/snippet}

{#snippet column(group: Group, laneKey: Value | undefined, rows: readonly Row[])}
  {@const name = groupName(group.key)}
  {@const lane = laneKey === undefined ? null : groupName(laneKey)}
  {@const tone = toneOfGroup(group)}
  <div
    class="column"
    class:washed={tone !== null && notes}
    class:closed={!carries}
    style:--wash={tone}
    data-column={name}
    data-lane={lane ?? undefined}
    data-column-key={laneKey === undefined ? name : undefined}
    role="group"
    aria-label={`${columnName(group)}, ${rows.length}`}
    onpointerdowncapture={() => (pickedFrom = { column: name, lane })}
    use:droppable={(row, at, place) => land(row, group, laneKey, at, place)}
  >
    {#if laneKey === undefined}{@render head(group)}{/if}
    <div class="cards" role="list">
      {#snippet one(row: Row)}{@render card(row, group, lane)}{/snippet}
      <BoardColumn bind:this={columns[placeKey(name, lane)]} {rows} {height} card={one} />
    </div>
    {#if pages}
      <div class="add">
        {#if notes}
          <BoardNew
            {kit}
            {group}
            {property}
            list={lists}
            lane={laneKey === undefined || sub === undefined
              ? undefined
              : { property: sub, key: laneKey, list: laneLists }}
            asked={asked[placeKey(name, lane)] ?? 0}
          />
        {:else}
          <AddRow {kit} {group} />
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="board" class:laned={lanes.length > 0} class:phone bind:this={board} onkeydown={keydown}>
  {#if phone && !lanes.length}
    <div class="strip" role="tablist" aria-label="Groups">
      {#each shownGroups as group (groupName(group.key))}
        {@const tone = toneOfGroup(group)}
        <button
          type="button"
          role="tab"
          class="switch"
          class:on={group === phoneColumn}
          class:toned={tone !== null}
          style:--pill={tone}
          aria-selected={group === phoneColumn}
          onclick={() => (showing = groupName(group.key))}
          >{columnName(group)} <span class="n">{group.rows.length}</span></button
        >
      {/each}
    </div>
    {#if phoneColumn}
      <div
        class="one"
        data-turns-pages
        onpointerdown={swipeStart}
        onpointerup={swipeEnd}
        onpointercancel={() => (swipeFrom = null)}
      >
        {@render column(phoneColumn, undefined, phoneColumn.rows)}
      </div>
    {/if}
  {:else if lanes.length}
    <div class="lanes">
      <div class="lane-heads">
        {#each shownGroups as group (groupName(group.key))}
          <div class="lane-head">{@render head(group)}</div>
        {/each}
      </div>
      {#each lanes as lane (groupName(lane))}
        <p class="orden-section lane">{groupLabel(sub, lane, live.today, laneNames)}</p>
        <div class="row">
          {#each shownGroups as group (groupName(group.key))}
            {@render column(group, lane, rowsOf(group, lane))}
          {/each}
        </div>
      {/each}
    </div>
  {:else}
    {#each shownGroups as group (groupName(group.key))}
      {@render column(group, undefined, group.rows)}
    {/each}
  {/if}

  {#if groupable && !phone}
    {#if naming}
      <div class="add-column field">
        <input
          class="orden-field"
          aria-label="New group"
          placeholder="New group"
          onkeydown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              naming = false
            }
          }}
          onblur={(event) => {
            if (naming) addGroup(event.currentTarget.value)
          }}
          use:focusSoon
        />
      </div>
    {:else}
      <button type="button" class="add-column" onclick={() => (naming = true)}
        ><svg viewBox="0 0 13 13" aria-hidden="true"><path d={ADD_MARK} /></svg>New group</button
      >
    {/if}
  {/if}

  {#if hiddenGroups.length && !phone}
    <div class="hidden" role="group" aria-label="Hidden groups">
      <p class="hidden-head">Hidden groups</p>
      {#each hiddenGroups as group (groupName(group.key))}
        {@const tone = toneOfGroup(group)}
        <button
          type="button"
          class="hidden-row"
          title="Show again"
          use:droppable={(row) => carryTo(row, group, undefined, group.rows.length, null)}
          onclick={() => kit.change((one, at) => setHidden(one, at, groupName(group.key), false))}
        >
          <span class="tag" class:toned={tone !== null} style:--pill={tone}
            >{columnName(group)}</span
          >
          <span class="count">{group.rows.length}</span>
        </button>
      {/each}
    </div>
  {/if}
  <p class="said" aria-live="polite">{said}</p>
</div>

<style>
  .board {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
    height: 100%;
    min-height: 0;
    padding: var(--space-3);
    overflow-x: auto;
  }

  .board.phone {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2);
    padding: var(--space-2);
    overflow: hidden;
  }

  .strip {
    flex: none;
    display: flex;
    gap: var(--space-1);
    overflow-x: auto;
    scrollbar-width: none;
  }

  .strip::-webkit-scrollbar {
    display: none;
  }

  .switch {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-height: var(--touch-target);
    padding: 0 var(--space-3);
    border: none;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .switch.on {
    background: var(--surface-3);
    color: var(--text-strong);
    font-weight: var(--weight-strong);
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }

  .switch.toned.on {
    background: color-mix(in srgb, var(--pill) 22%, transparent);
    color: color-mix(in srgb, var(--pill) 62%, var(--text-strong));
    box-shadow: none;
  }

  .switch .n {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .one {
    flex: 1;
    display: flex;
    align-items: flex-start;
    min-height: 0;
  }

  .one .column {
    width: 100%;
  }

  .one,
  .one :global(.scroll) {
    touch-action: pan-y pinch-zoom;
  }

  .lanes {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: min-content;
  }

  .lane-heads,
  .row {
    display: flex;
    gap: var(--space-3);
  }

  .lane-head {
    width: 272px;
  }

  .row .column {
    max-height: 420px;
  }

  .lane {
    margin: var(--space-2) 0 0;
  }

  .column {
    flex: none;
    display: flex;
    flex-direction: column;
    width: 272px;
    min-height: 0;
    max-height: 100%;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    transition: box-shadow var(--dur-fast) var(--ease-out);
  }

  .column.washed {
    background: color-mix(in srgb, var(--wash) 7%, var(--surface-2));
  }

  :global([data-theme='dark']) .column.washed {
    background: color-mix(in srgb, var(--wash) 10%, var(--surface-2));
  }

  .cards {
    flex: 0 1 auto;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .head-field {
    display: flex;
    align-items: center;
    height: var(--row-height);
    padding: 0 var(--space-2);
  }

  .head-field input {
    width: 100%;
    min-height: var(--row-height-sm);
  }

  .add-column {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    align-self: flex-start;
    width: 272px;
    height: var(--row-height);
    padding: 0 var(--space-3);
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .add-column.field {
    padding: 0 var(--space-2);
  }

  .add-column.field input {
    width: 100%;
  }

  .add-column svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
  }

  @media (hover: hover) {
    .add-column:hover {
      background: var(--surface-2);
      color: var(--text);
    }
  }

  .column:global(.is-carried) {
    opacity: 0.45;
  }

  .column:global(.is-before),
  .column:global(.is-after) {
    position: relative;
  }

  .column:global(.is-before)::before,
  .column:global(.is-after)::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    border-radius: 1px;
    background: var(--accent);
    pointer-events: none;
  }

  .column:global(.is-before)::before {
    left: calc(var(--space-3) / -2 - 1px);
  }

  .column:global(.is-after)::after {
    right: calc(var(--space-3) / -2 - 1px);
  }

  .column:global(.is-taking) {
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .column.closed:global(.is-taking) {
    box-shadow: inset 0 0 0 1px var(--line-strong);
    cursor: not-allowed;
  }

  .add {
    flex: none;
  }

  .hidden {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    align-self: flex-start;
    width: 220px;
    padding: 0 0 var(--space-2);
  }

  .hidden-head {
    display: flex;
    align-items: center;
    height: var(--row-height);
    margin: 0;
    padding: 0 var(--space-3);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .hidden-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: var(--row-height);
    padding: 0 var(--space-2);
    border: none;
    border-radius: var(--radius-row);
    background: none;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .hidden-row:hover {
      background: var(--surface-hover);
    }
  }

  .hidden-row:global(.is-taking) {
    background: var(--surface-selected);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .tag {
    min-width: 0;
    overflow: hidden;
    padding: 1px var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--surface-3);
    color: var(--text-strong);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tag.toned {
    background: color-mix(in srgb, var(--pill) 22%, transparent);
    color: color-mix(in srgb, var(--pill) 62%, var(--text-strong));
  }

  .count {
    margin-inline-start: auto;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .said {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
