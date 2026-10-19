<script lang="ts">
  /** The board, Notion's: a column per group, in the view's own column order, then the
   *  options', empty columns kept unless the view hides them, the group of no value at
   *  the end (or first, where the view says so), the groups hidden from their menu in
   *  a column of their own at the end that still takes cards, and a sub-group
   *  splitting the columns into swimlanes (docs/tasks.md 5.9).
   *
   *  Grouped by a list, a card stands in the column of each of its members. A card
   *  carried to another column writes the property the board groups by (only the
   *  member it was carried from, for a list) and where it was let go, as one undo; it
   *  stands there at once and goes back only if the write fails, with a way to try
   *  again. Carried within its column it keeps the view's manual order (`nib.order`),
   *  which a sort set on the view would overrule, so the board asks once whether to
   *  take the sort away. Grouped by status, a task line's box is the column.
   *
   *  Every card of a view is one height, set by its card size, so a column of two
   *  thousand cards mounts the dozen on screen. The board is one stop for Tab: the
   *  arrows walk its cards, Alt and an arrow carries one, Enter opens it, Q adds to its
   *  column, and the row keys do to a task what they do in a list.
   *
   *  A project's board is Todoist's: a column per section, each with the section's menu
   *  (section-actions.ts), the tasks in no section first, and Add section at the end. */
  import {
    type Answer,
    groupName,
    type Group,
    orderId,
    type Row,
    rowId,
    type Value,
  } from '@nib/bases'
  import { tick, untrack } from 'svelte'
  import { t } from '../i18n.svelte'
  import { menu, type MenuEntry } from '../menu.svelte'
  import { prompt } from '../prompt.svelte'
  import { shortcuts } from '../shortcuts.svelte'
  import { viewport } from '../viewport.svelte'
  import { asOneUndo, dropRow } from './act'
  import AddRow from './AddRow.svelte'
  import {
    cardHeight,
    cardKey,
    cardLines,
    cardProperties,
    checklists,
    DEFAULT_SIZE,
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
  import { droppable, placeAmong, type Point } from './drag.svelte'
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
  import { laneKeys, withEveryDay, withEverySection, withinDays } from './list-items'
  import type { Kit } from './kit'
  import { holdsLists, optionsAt } from './options'
  import { priorityTone } from '../quick-add/labels'
  import { rowKey } from './row-keys'
  import { runKey } from './task-actions'
  import { dayHead, groupLabel, propertyName, summaryName } from './words'
  import {
    addSection,
    projectOf,
    renameSection,
    placeSection,
    sectionMenu,
    sectionsHere,
  } from './section-actions'
  import { reorderDrag } from './reorder-drag'
  import { isTitle } from './sections'
  import { ADD_MARK } from './marks'
  import { focusSoon } from './focus-soon'

  const {
    kit,
    days,
    adding = 0,
  }: {
    kit: Kit
    /** Every day from one through another a column, empty ones too: Upcoming's board. */
    days?: { from: string; through: string } | undefined
    /** How many times the head's New asked for a page: the first column's New page
     *  opens, the phone's column on a phone. */
    adding?: number
  } = $props()

  const live = $derived(kit.live)
  const view = $derived(live.view)
  const base = $derived(live.base)
  const property = $derived(view?.groupBy?.property)
  const sub = $derived(view?.nib.subGroupBy?.property)
  const hidden = $derived(view?.nib.hidden ?? [])
  const kinds = $derived(view?.nib.rows ?? 'notes')
  const notes = $derived(kinds === 'notes')
  /** A board in a note's fence has no room for adding: the base's own tab has. */
  const adds = $derived(!kit.compact)
  /** Pages are added in every board, a block's too; a new group only where there is room. */
  const pages = true
  const sorted = $derived((view?.sort.length ?? 0) > 0)
  /** Whether a card can be carried to another column at all. */
  const carries = $derived(droppableBy(property, kinds))
  const coloured = $derived(view?.nib.colourColumns !== false)
  const phone = $derived(viewport.device === 'phone')
  /** The project the board is of, its columns its sections. */
  const project = $derived(property === 'task.section' ? projectOf(kit) : null)
  /** The property's choices, when it has them: its columns are the options. */
  const options = $derived(base && property ? optionsAt(base, property) : [])
  const lists = $derived(property?.startsWith('note.') ? holdsLists(live.rows, property) : false)

  /** Cards carried and not written yet, drawn where they were let go. */
  let pending = $state<Pending[]>([])
  /** A column's manual order written and not read back yet, drawn already, so the
   *  keyboard that reordered it finds its card where it went. */
  let shuffled = $state<{ column: string; order: string[] } | null>(null)

  const answered = $derived(
    project
      ? withEverySection(live.answer?.groups ?? [], sectionsHere(project.relative), project.name)
      : days
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
        !hidden.includes(groupName(group.key)) && !(view?.nib.hideEmpty && group.rows.length === 0),
    ),
  )
  const hiddenGroups = $derived(groups.filter((group) => hidden.includes(groupName(group.key))))
  /** The columns' keys as text, in the order they stand. */
  const names = $derived(shownGroups.map((group) => groupName(group.key)))

  // Written cards come back from the rows; the pending ones they were drawn as go.
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

  /** The swimlanes: every sub-group key any column has, in the order they first come. */
  const lanes = $derived(sub === undefined ? [] : laneKeys(shownGroups))
  /** The lanes the keyboard walks: a board without them is one lane of no key. */
  const walked = $derived<(Value | undefined)[]>(lanes.length ? lanes : [undefined])
  /** Whether the lane property holds lists, so a new card holds a list of its lane's one. */
  const laneLists = $derived(sub?.startsWith('note.') ? holdsLists(live.rows, sub) : false)

  /** A lane's key, from its key as text. */
  const laneOf = (lane: string | null): Value | undefined =>
    lane === null ? undefined : lanes.find((one) => groupName(one) === lane)

  /** One column of one lane, by column and lane as text, apart from every other. */
  const placeKey = (column: string, lane: string | null) =>
    lane === null ? column : `${column}\n${lane}`

  /** The box of one column of one lane, for finding a card in it. */
  const placeSelector = (column: string, lane: string | null) =>
    `[data-column="${CSS.escape(column)}"]` +
    (lane === null ? '' : `[data-lane="${CSS.escape(lane)}"]`)

  /** What a card shows under its title, and how tall that makes every card. */
  const shown = $derived(cardProperties(live.columns, property, sub))
  const checked = $derived(checklists(live.rows))
  const anyChecklist = $derived(
    shownGroups.some((group) => group.rows.some((row) => checked.has(noteKey(row)))),
  )
  const lines = $derived(
    cardLines(view?.nib.cardSize ?? DEFAULT_SIZE, shown.length, !notes || anyChecklist),
  )
  const height = $derived(cardHeight(lines, viewport.touch))

  /** The section a column is, or null for one that is none: no heading, or the title. */
  function sectionOf(group: Group): string | null {
    const key = group.key
    if (!project || typeof key !== 'string' || !key || isTitle(key, project.name)) return null
    return key
  }

  /** What the column of no value is called: No and the property's name. */
  const nothing = $derived(
    property && !project && !days
      ? t('No {property}', {
          property: propertyName(property, base ? displayName(base, property) : undefined),
        })
      : t('None'),
  )

  /** What a column is called: a project's tasks in no section are that, not its title. */
  function columnName(group: Group): string {
    if (project && sectionOf(group) === null) return t('None')
    if (days) return dayHead(group.key, live.today)
    if (group.key === null || group.key === '') return nothing
    return groupLabel(property, group.key, live.today)
  }

  /** The tone a column's head wears: its option's, a task's box's or its priority's. */
  function toneOfGroup(group: Group): string | null {
    if (!coloured) return null
    const key = group.key
    if (property === 'task.status' && typeof key === 'string')
      return key === '/' ? 'var(--canvas-3)' : key.toLowerCase() === 'x' ? 'var(--canvas-4)' : null
    if (property === 'task.priority' && typeof key === 'number') return priorityTone(key) ?? null
    return toneColour(optionFor(base, property ?? '', key)?.tone)
  }

  /** A value the notes hold that no option does, where the property has options. */
  function unlisted(group: Group): boolean {
    const key = group.key
    return (
      options.length > 0 &&
      typeof key === 'string' &&
      key !== '' &&
      !options.some((one) => one.value === key)
    )
  }

  /** A column's head being renamed in place, by key as text. */
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
      label: t('Hide'),
      run: () => kit.change((one, at) => setHidden(one, at, name, true)),
    }
    const section = sectionOf(group)
    if (section !== null) {
      sectionMenu(
        event,
        kit,
        section,
        group.rows.length,
        () => ask(t('Rename'), section, (words) => renameSection(kit, section, words)),
        [hide],
      )
      return
    }
    if (!property || project || days) {
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

  /** A column's calculation: Count, or a summary of one of the view's properties. */
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
          label: t('Count'),
          checked: !Object.keys(summaries).length,
          run: () =>
            kit.change((next, at) =>
              Object.keys(summaries).reduce((one, key) => setSummary(one, at, key, null), next),
            ),
        },
        ...offered,
      ],
      { title: t('Calculate') },
    )
  }

  /** What a column's calculations read. */
  function sumsOf(group: Group): string[] {
    return Object.keys(view?.summaries ?? {})
      .map((one) => valueText(group.summaries[one] ?? null, live.today))
      .filter(Boolean)
  }

  /** A name asked for, then written. */
  function ask(title: string, value: string, write: (words: string) => void) {
    void prompt
      .ask({ title, value, confirmLabel: title })
      .then((words) => (words?.trim() ? write(words) : undefined))
  }

  /** The column a carried card was picked up from, which a list's card needs: it
   *  stands in a column per member, and only that member is carried. Set by a press
   *  that may not become a carry, so a carry trusts it only where the card is. */
  let pickedFrom: { column: string; lane: string | null } | null = null

  /** Where among a column's cards a point falls, counting the ones scrolled out of
   *  sight: the cards are windowed, so only those on screen can be asked. */
  function indexAt(place: HTMLElement, at: Point): number {
    const slots = [...place.querySelectorAll<HTMLElement>('[data-index]')]
    const found = placeAmong(slots, at)
    const first = Number(slots[0]?.dataset.index ?? 0)
    return slots.length ? first + found : 0
  }

  /** The cards of a column, or of one lane of it, as they stand. */
  function rowsOf(group: Group, laneKey: Value | undefined): readonly Row[] {
    if (laneKey === undefined) return group.rows
    return group.sub?.find((one) => groupName(one.key) === groupName(laneKey))?.rows ?? []
  }

  /** Whether a card stands in a column (and a lane of it) now. */
  function holds(where: { column: string; lane: string | null }, row: Row): boolean {
    const group = groups.find((one) => groupName(one.key) === where.column)
    const key = cardKey(row)
    return !!group && rowsOf(group, laneOf(where.lane)).some((one) => cardKey(one) === key)
  }

  /** Where a card stands now: in `column`, or else the first column that has it, and
   *  its lane in that one. */
  function whereIs(row: Row, given?: string): { column: string; lane: string | null } {
    const column = given ?? columnOf(row) ?? ''
    const group = groups.find((one) => groupName(one.key) === column)
    const key = cardKey(row)
    const lane = group?.sub?.find((one) => one.rows.some((each) => cardKey(each) === key))
    return { column, lane: lane ? groupName(lane.key) : null }
  }

  /** A card let go over a column (or a lane of it), at a place among its cards: the
   *  place counts the card's own slot where it stands there still. */
  function land(row: Row, group: Group, laneKey: Value | undefined, at: Point, place: HTMLElement) {
    const key = cardKey(row)
    const was = rowsOf(group, laneKey).findIndex((one) => cardKey(one) === key)
    carryTo(row, group, laneKey, indexWithout(indexAt(place, at), was), at)
  }

  /** The order `drops` are written in: a field before a tick and a tick before a
   *  move, since a move takes the line to where the row no longer says it is. Two
   *  fields are one write. */
  function inTurn(drops: readonly (Drop | null)[]): Drop[] {
    const given = drops.filter((one): one is Drop => one !== null)
    const changes = given.flatMap((one) => ('change' in one ? [one.change] : []))
    const change: Drop[] = changes.length
      ? [
          {
            change: changes.reduce((one, next) => ({
              note: { ...one.note, ...next.note },
              task: { ...one.task, ...next.task },
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
    // Carried with no lane said, from the menu or onto a hidden group, a card keeps
    // the lane it stands in.
    const toLane = laneKey ?? (sub === undefined ? undefined : laneOf(from.lane))
    const lane = toLane === undefined ? null : groupName(toLane)
    const ids = rowsOf(group, toLane).map(orderId)
    const id = orderId(row)
    const laneOrder = orderAfter(ids, id, index)
    // A lane's order is written into its column's, where the other lanes' are kept.
    const order = toLane === undefined ? laneOrder : mergedOrder(group.rows.map(orderId), laneOrder)

    if (from.column === name && (lane === null || from.lane === lane)) {
      if (laneOrder.join('\n') === ids.join('\n')) return
      reorder(name, order, at)
      return
    }
    if (!carries) return

    // Only what changed is written: the column where the card left its column, the lane
    // where it left its lane, each a member swapped where the property is a list.
    const fromKey = groups.find((one) => groupName(one.key) === from.column)?.key
    const first = from.column === name ? null : dropInto(by, group.key, row, live.today, fromKey)
    const second =
      toLane !== undefined && sub !== undefined && from.lane !== lane
        ? dropInto(sub, toLane, row, live.today, laneOf(from.lane))
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
    announce(t('{card} moved to {group}', { card: titleOf(row), group: columnName(group) }))
    // Where it was let go is kept unless a sort places it, or it went to the end of a
    // column with no order of its own, which is where it lands anyway.
    const others = ids.filter((one) => one !== id).length
    const stored = (view?.nib.order?.[name]?.length ?? 0) > 0
    const keepOrder = !sorted && (stored || index < others)

    const write = async () => {
      let wrote = false as boolean
      await asOneUndo([
        ...drops.map((drop) => async () => (wrote = await dropRow(row, drop))),
        () => (wrote && keepOrder ? writeOrder(name, order) : Promise.resolve(false)),
      ])
      if (wrote) {
        pending = pending.map((one) => (one === moving ? { ...one, written: true } : one))
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

  /** A column's manual order written, the ids of cards no longer anywhere left out. */
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

  /** A card reordered within its column, unless a sort says where it goes: then the
   *  board asks once whether to take the sort away. */
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
          label: t('Remove sort'),
          run: () => shuffle(name, order, true),
        },
        { label: t('Cancel'), run: () => undefined },
      ],
      { title: t('Remove sort?') },
    )
  }

  /** A column's manual order drawn at once and written, drawn as it was again if the
   *  write is turned away. */
  function shuffle(name: string, order: string[], unsorted: boolean) {
    const mine = { column: name, order }
    shuffled = mine
    void writeOrder(name, order, unsorted).then((wrote) => {
      if (!wrote && shuffled === mine) shuffled = null
    })
  }

  /** The column a card stands in now, by key as text. */
  function columnOf(row: Row): string | null {
    const key = cardKey(row)
    const found = shownGroups.find((group) => group.rows.some((one) => cardKey(one) === key))
    return found ? groupName(found.key) : null
  }

  const titleOf = (row: Row) => row.task?.text ?? row.file.basename

  /** What the live region last said. */
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

  /** The card the keyboard is on, by column, lane and card. */
  let focus = $state<{ column: string; lane: string | null; card: string } | null>(null)
  /** Each column's cards, by column and lane (`placeKey`). */
  const columns: Record<string, { reveal: (index: number) => void } | undefined> = {}
  /** How many times Q asked a column's New page to open, by column and lane. */
  let asked = $state<Record<string, number>>({})

  function askNew(column: string, lane: string | null) {
    const key = placeKey(column, lane)
    asked = { ...asked, [key]: (asked[key] ?? 0) + 1 }
  }

  /** The card Tab reaches: the one the keyboard was on while it is still there, else
   *  the board's first. */
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

  /** Puts the keyboard on the card at `index` of a column's lane, or its New page. */
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

  /** Puts the keyboard on a card by which card it is, wherever in its column and lane
   *  it stands once what was just done to it is drawn. */
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

  function keydown(event: KeyboardEvent) {
    if (event.defaultPrevented) return
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
        // A sort asks first, and the menu that asks has the keyboard.
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
    const key = rowKey(event, (id) => shortcuts.keyFor(id), shortcuts.platform)
    if (!key || key.kind === 'step' || key.kind === 'pick' || key.kind === 'unpick') return
    if (key.kind === 'fold' || key.kind === 'edit' || key.kind === 'indent') return
    if (key.kind === 'add') {
      // The board's own add, which the view's Q would otherwise make a second of.
      event.preventDefault()
      event.stopPropagation()
      if (notes) askNew(name, laneName)
      else kit.add(property ? { property, key: group.key } : undefined)
      return
    }
    const box = face.getBoundingClientRect()
    if (key.kind === 'more') {
      event.preventDefault()
      cardMenu(new MouseEvent('contextmenu', { clientX: box.left, clientY: box.bottom }), row, name)
      return
    }
    if (key.kind === 'move') return
    if (runKey(kit, [row], key, box)) event.preventDefault()
  }

  /** The phone's one column, by key as text. */
  let showing = $state<string | null>(null)
  const phoneColumn = $derived(
    shownGroups.find((group) => groupName(group.key) === showing) ?? shownGroups[0],
  )

  // Only a New pressed while the board is up opens a page: a board drawn again, its
  // layout switched back to, opens nothing for the presses before it.
  let addingSeen = untrack(() => adding)
  $effect(() => {
    if (adding <= addingSeen) return
    addingSeen = adding
    const first = untrack(() => (phone ? phoneColumn : shownGroups[0]))
    if (!first) return
    const lane = untrack(() => lanes[0])
    untrack(() => askNew(groupName(first.key), lane === undefined ? null : groupName(lane)))
  })

  /** A new group: an option of the property the board groups by. */
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
  /** Whether the board's columns are a property's options, which a new one can join. */
  const groupable = $derived(!project && !days && adds && property?.startsWith('note.') === true)
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
  {@const section = sectionOf(group)}
  {#if renaming === name}
    <div class="head-field">
      <input
        class="nib-field"
        value={name}
        aria-label={t('Rename')}
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
        id: project ? (section ?? '') : name,
        among: project ? 'section' : 'column',
        across: true,
        place: (moving, target, after) =>
          project
            ? placeSection(kit, moving, target, after)
            : kit.change((one, at) => placeColumn(one, at, names, moving, target, after)),
      }}
    >
      <BoardHead
        name={columnName(group)}
        tone={toneOfGroup(group)}
        count={group.rows.length}
        sums={sumsOf(group)}
        muted={unlisted(group)}
        carries={!project || section !== null}
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
  {@const section = laneKey === undefined ? sectionOf(group) : null}
  {@const tone = toneOfGroup(group)}
  <div
    class="column"
    class:washed={tone !== null}
    class:closed={!carries}
    style:--wash={tone}
    data-section={section ?? undefined}
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
    <div class="strip" role="tablist" aria-label={t('Groups')}>
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
      <div class="one">{@render column(phoneColumn, undefined, phoneColumn.rows)}</div>
    {/if}
  {:else if lanes.length}
    <div class="lanes">
      <div class="lane-heads">
        {#each shownGroups as group (groupName(group.key))}
          <div class="lane-head">{@render head(group)}</div>
        {/each}
      </div>
      {#each lanes as lane (groupName(lane))}
        <p class="nib-section lane">{groupLabel(sub, lane, live.today)}</p>
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

  {#if project && adds && !phone}
    <button
      type="button"
      class="add-column"
      onclick={() => ask(t('Add section'), '', (words) => addSection(kit, words))}
      ><svg viewBox="0 0 13 13" aria-hidden="true"><path d={ADD_MARK} /></svg>{t(
        'Add section',
      )}</button
    >
  {:else if groupable && !phone}
    {#if naming}
      <div class="add-column field">
        <input
          class="nib-field"
          aria-label={t('New group')}
          placeholder={t('New group')}
          onkeydown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              naming = false
            }
          }}
          onblur={(event) => {
            // Escape has let it go already, and what it holds is not a group.
            if (naming) addGroup(event.currentTarget.value)
          }}
          use:focusSoon
        />
      </div>
    {:else}
      <button type="button" class="add-column" onclick={() => (naming = true)}
        ><svg viewBox="0 0 13 13" aria-hidden="true"><path d={ADD_MARK} /></svg>{t(
          'New group',
        )}</button
      >
    {/if}
  {/if}

  {#if hiddenGroups.length && !phone}
    <div class="hidden" role="group" aria-label={t('Hidden groups')}>
      <p class="hidden-head">{t('Hidden groups')}</p>
      {#each hiddenGroups as group (groupName(group.key))}
        {@const tone = toneOfGroup(group)}
        <button
          type="button"
          class="hidden-row"
          title={t('Show again')}
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
  /* Columns as tall as their cards, the way Notion's are, up to the board's height. */
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

  /* An option's tone as a faint wash over the column, Notion's coloured groups. */
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

  /* Where the next column would stand: a column's width, quiet until pointed at. */
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

  /* A grouping no drop can write (a formula, a file's facts) takes no card. */
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
