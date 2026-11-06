<script lang="ts">
  import { tick, untrack } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { door } from '@orden/markdown/door'
  import { fileMark, type FileMark as Mark } from './file-mark'
  import { hiddenKinds } from './settings.svelte'
  import FileMark from './FileMark.svelte'
  import {
    folderFor,
    folderNote,
    folderNotePath,
    isFolderNote,
    nestedIn,
    renameSteps,
  } from './folder-notes'
  import { t } from './i18n.svelte'
  import { staysOn } from './caret'
  import { focusList } from './focus'
  import { menu } from './menu.svelte'
  import { overlays } from './overlays'
  import { longPress } from './longpress'
  import { landsIn } from './move-targets'
  import NameField from './NameField.svelte'
  import { howFor, middleOpens, tabAsk } from './new-tab'
  import { extensionOf } from './naming'
  import { rowName } from './note-name'
  import { roving } from './roving'
  import SharedMark from './SharedMark.svelte'
  import { LOCK_MARK } from './protect/entries'
  import { canWriteAt, isSharedItem, othersIn } from './sharing.svelte'
  import { shortcuts } from './shortcuts.svelte'
  import { syncMark } from './surfaces.svelte'
  import { carried, carriedNothing, carry, isBookmarkDrag, landing } from './drag-paths'
  import { dropOnList, fileClipboard, listMotion } from './list-landing.svelte'
  import { dropTarget, targetFor } from './drop-target.svelte'
  import {
    autoScrollBy,
    heightOf,
    offsetOf,
    type Fold,
    type Rows,
    slotsFor,
    windowFor,
  } from './row-window'
  import { ListView, tokenFloor, tokenRow } from './row-window.svelte'
  import { folderOf } from './space-paths'
  import { flatRows, heldRows, rowIndex, standsOpen, type FlatRow } from './tree-flat'
  import { steppedKey } from './direction'
  import { onTwist, treeStep, TREE_MOVES } from './tree-keys'
  import { viewport } from './viewport.svelte'
  import type { Entry } from './workspace.svelte'
  import { workspace } from './workspace.svelte'
  import { inside } from './workspace/zones'
  import Twist from './Twist.svelte'
  import { dur } from './motion'
  import { keptAway } from './web/away.svelte'
  import { rowIds } from './row-ids'
  import { indexed, settle } from './tree-settle'

  const { tree }: { tree: Entry } = $props()

  const OVERSCAN = 6

  const FOLDING = 190

  let wrong = $state(false)

  const isOpen = (path: string) => workspace.isExpanded(path)

  const manual = $derived(workspace.sortMode === 'manual')

  const live = $derived(flatRows(tree, isOpen))

  let frozen = $state<FlatRow[] | null>(null)

  const flat = $derived(frozen ?? live)

  const at = $derived(rowIndex(flat))

  const ids = $derived(flat.map((row) => rowIds.idOf(row.entry.path)))

  const atId = $derived(indexed(ids))

  const among = $derived.by(() => {
    const groups: Record<string, number[]> = {}
    flat.forEach((row, index) => {
      const parent = row.entry.path.slice(0, row.entry.path.lastIndexOf('/'))
      ;(groups[parent] ??= []).push(index)
    })
    const out: { position: number; size: number }[] = []
    for (const group of Object.values(groups)) {
      group.forEach((index, place) => (out[index] = { position: place + 1, size: group.length }))
    }
    return out
  })

  let list = $state<HTMLUListElement>()

  const where = new ListView()

  const rowOf = () => tokenRow(viewport.touch)
  const rowHeight = $derived(where.row || tokenFloor(viewport.touch))

  $effect(() => {
    where.refresh(tokenRow(viewport.touch))
  })

  let fold = $state<Fold | null>(null)

  let standing = $state<string | null>(null)
  let reaching = $state<string | null>(null)

  let standingAt = -1
  let standingPath = ''
  let keyedOn = false

  $effect(() => {
    const gone = standing !== null && !atId.has(standing)
    if (!gone) {
      if (standing !== null) {
        standingAt = atId.get(standing) ?? standingAt
        standingPath = flat[standingAt]?.entry.path ?? standingPath
      }
      return
    }
    untrack(() => {
      const was = standingPath
      standing = null
      const index = Math.min(standingAt, flat.length - 1)
      const next = flat[index]
      const nowhere =
        keyedOn || document.activeElement === null || document.activeElement === document.body
      keyedOn = false
      if (
        next &&
        nowhere &&
        workspace.rootHolding(next.entry.path) === workspace.rootHolding(was)
      ) {
        stand(next.entry.path, true)
      } else if (!next && nowhere) {
        void tick().then(standOnList)
      }
    })
  })

  const pinned = $derived(
    [pathAt(workspace.naming?.path), idAt(standing), idAt(reaching)].filter(
      (one): one is number => one !== null,
    ),
  )

  const rows = $derived<Rows>({
    count: flat.length,
    height: rowHeight,
    top: where.top,
    room: where.room,
    overscan: OVERSCAN,
    fold,
    pinned,
  })

  const view = $derived(windowFor(rows))

  interface Drawn {
    row: FlatRow
    index: number
    away: boolean
    id: string
  }

  const drawn = $derived.by(() => {
    const out: Drawn[] = []
    const skip = view.skip

    for (let index = view.first; index <= view.last; index++) {
      if (skip && index >= skip.from && index <= skip.to) continue

      const row = flat[index]
      if (row) out.push({ row, index, away: false, id: ids[index] ?? row.entry.path })
    }

    for (const index of view.pinned) {
      const row = flat[index]
      if (row) out.push({ row, index, away: true, id: ids[index] ?? row.entry.path })
    }

    return out.sort((one, other) => one.index - other.index)
  })

  const lastSlots = { held: new Map<string, number>() }
  const slots = $derived.by(
    () =>
      (lastSlots.held = slotsFor(
        lastSlots.held,
        drawn.map((one) => one.id),
      )),
  )

  function pathAt(path: string | null | undefined): number | null {
    if (path === null || path === undefined) return null
    return at.get(path) ?? null
  }

  function idAt(id: string | null): number | null {
    return id === null ? null : (atId.get(id) ?? null)
  }

  function pick(event: MouseEvent, entry: Entry): boolean {
    const ask = tabAsk(event)
    if (ask !== 'plain') {
      void workspace.openRow(entry.path, howFor(ask))
      return true
    }
    if (event.altKey) {
      workspace.toggleSelect(entry.path)
      return true
    }
    if (event.shiftKey) {
      workspace.selectRange(entry.path)
      return true
    }
    workspace.select(entry.path)
    return false
  }

  function rowPath(event: KeyboardEvent): string | null {
    const from = event.target instanceof Element ? event.target.closest('.row') : null
    return from instanceof HTMLElement ? (from.dataset.path ?? null) : null
  }

  async function reach(index: number): Promise<HTMLElement | null> {
    const row = flat[index]
    if (!row) return null

    reaching = ids[index] ?? null
    await tick()

    const line = list?.querySelector(`li[data-row="${index}"]`)
    if (!(line instanceof HTMLElement)) return null

    line.scrollIntoView({ block: 'nearest' })
    where.refresh()

    const found = line.querySelector('.row[data-path]')
    return found instanceof HTMLElement ? found : null
  }

  function standOnList() {
    if (!focusList() && list) {
      list.tabIndex = -1
      list.focus()
    }
    if (document.activeElement) staysOn(document.activeElement)
  }

  function stand(path: string, stays = false) {
    workspace.select(path)

    const index = at.get(path)
    if (index === undefined) return

    void reach(index).then((row) => {
      row?.focus()
      if (row && stays) staysOn(row)
    })
  }

  function walkKey(event: KeyboardEvent): string | null {
    for (const [id, key] of TREE_MOVES) {
      if (shortcuts.pressed(id, event)) return steppedKey(key)
    }

    return null
  }

  function onKey(event: KeyboardEvent) {
    if (event.target instanceof HTMLInputElement) return

    if (shortcuts.pressed('tree.select-all', event)) {
      event.preventDefault()
      workspace.selectAll()
      return
    }

    const deleting =
      shortcuts.pressed('tree.delete', event) || shortcuts.pressed('tree.delete.alt', event)
    if (deleting && workspace.selection.length) {
      event.preventDefault()
      if (!workspace.selection.every((path) => canWriteAt(path))) return
      keyedOn = true
      const kept = workspace.selection.filter((path) => workspace.keepsArchived(path))
      void workspace.removeMany(workspace.selection)
      if (kept.length) void import('./row-menu').then((one) => one.refuseDeleting(kept))
      return
    }

    const here = rowPath(event)
    if (fileKey(event, here) || here === null) return

    const step = shortcuts.pressed('tree.extend-down', event)
      ? 1
      : shortcuts.pressed('tree.extend-up', event)
        ? -1
        : 0
    if (step !== 0) {
      event.preventDefault()
      stretch(here, step)
      return
    }

    if (shortcuts.pressed('tree.toggle', event)) {
      event.preventDefault()
      workspace.toggleSelect(here)
      return
    }

    if (shortcuts.pressed('tree.rename', event) && canWriteAt(here)) {
      event.preventDefault()
      workspace.startRenaming(here)
      return
    }

    const moving = shortcuts.pressed('tree.move-up', event)
      ? -1
      : shortcuts.pressed('tree.move-down', event)
        ? 1
        : 0

    if (moving !== 0) {
      event.preventDefault()
      const code = lift
      if (!code) {
        void liftCode().then((then) => then.moveInOrder(here, moving))
        return
      }

      const was = code.placesOf(held)
      if (code.moveInOrder(here, moving)) void code.slideInto(held, was)
    }
  }

  const FILE_KEYS: [string[], (rows: string[], into: string) => unknown, boolean][] = [
    [['fixed.copy'], (rows) => fileClipboard.hold(rows, false), false],
    [['fixed.cut'], (rows) => fileClipboard.hold(rows, true), true],
    [['fixed.paste'], (_, into) => fileClipboard.paste(into), true],
    [['edit.undo'], () => workspace.undoFileAction(), false],
    [['edit.redo', 'edit.redo.alt'], () => workspace.redoFileAction(), false],
    [['tree.duplicate'], (rows) => workspace.duplicateMany(rows), true],
    [
      ['app.new'],
      (_, into) => (hiddenKinds.offers('note') ? workspace.createNote(into) : null),
      true,
    ],
  ]

  function fileKey(event: KeyboardEvent, here: string | null): boolean {
    const found = FILE_KEYS.find(([ids]) => ids.some((id) => shortcuts.pressed(id, event)))
    const entry = here === null ? null : entryFor(here)
    const into =
      entry?.is_dir === false ? folderOf(entry.path) : (entry?.path ?? workspace.activeSpace?.root)
    if (!found || into === undefined) return false

    event.preventDefault()
    const [, run, writes] = found
    if (writes && !canWriteAt(into)) return true

    const rows = workspace.selection.length ? workspace.selection : here === null ? [] : [here]
    void run(rows, into)
    return true
  }

  function stretch(here: string, step: number) {
    const index = at.get(here)
    const next = index === undefined ? undefined : flat[index + step]
    if (index === undefined || !next) return

    workspace.extendSelection(here, next.entry.path)
    void reach(index + step).then((row) => row?.focus())
  }

  function sideways(key: string, row: HTMLElement): boolean {
    const here = row.dataset.path
    if (here === undefined) return false
    if (key !== 'ArrowRight' && key !== 'ArrowLeft') return false

    const step = treeStep(key, workspace.visibleTree(), here)
    if (!step) return false

    if (step.do === 'stand') stand(step.path)
    else workspace.toggleFolder(step.path)

    return true
  }

  function openRow(row: HTMLElement) {
    const here = row.dataset.path
    if (here !== undefined) void workspace.openRow(here)
  }

  function peekRow(row: HTMLElement) {
    const here = row.dataset.path
    if (here === undefined) return

    void workspace.openRow(here, { preview: true })
    row.focus()
  }

  function leaveList(): boolean {
    if (!workspace.selection.length) return false

    workspace.clearSelection()
    return true
  }

  function nameToEdit(entry: Entry): string {
    if (workspace.naming?.making) return ''

    const name = labelOf(entry)
    return workspace.naming?.appending ? `${name} ` : name
  }

  function markOf(entry: Entry, own: Entry | null): Mark {
    if (own) return fileMark(own.name)
    return entry.is_dir ? 'file' : fileMark(entry.name)
  }

  function labelOf(entry: Entry): string {
    return rowName(entry.name, entry.is_dir)
  }

  function markPath(entry: Entry, own: Entry | null): string {
    return own?.path ?? entry.path
  }

  function commit(entry: Entry, own: Entry | null, name: string) {
    if (workspace.naming?.making) void workspace.makeNamed(name)
    else if (own) void renameNested(own, name)
    else void workspace.rename(entry.path, name)
  }

  async function renameNested(note: Entry, name: string) {
    for (const step of renameSteps(note.path, name)) {
      await workspace.rename(step.path, step.name)
    }
  }

  function startDrag(event: DragEvent, path: string) {
    const paths = workspace.dragPayload(path)
    carry(event.dataTransfer, paths)
    carrying = paths
    workspace.panes.dragged({ tabId: null })
    void import('./tab-strip/space-drop').then((drop) => drop.followTreeDrag(paths))
  }

  function endDrag() {
    workspace.panes.dropped()
    carriedNothing()
    letGo()
    stopRolling()
  }

  let carrying = $state<string[]>([])

  let lift = $state<typeof import('./tree-lift') | null>(null)
  const liftCode = door(() => import('./tree-lift').then((code) => (lift = code)))

  $effect(() => {
    if (manual) void liftCode()
  })

  const entryFor = (path: string): Entry | null => {
    const index = at.get(path)
    return index === undefined ? null : (flat[index]?.entry ?? null)
  }

  const held = {
    rows: () => list?.querySelectorAll<HTMLElement>('.row[data-path]') ?? [],
    entryFor,
    carrying: () => carrying,
    carry: (paths: readonly string[]) => {
      carrying = [...paths]
    },
    edge: (at: number | null) => {
      if (at === null) {
        stopRolling()
        return
      }

      edgeAt = at
      rolling ??= requestAnimationFrame(rollOn)
    },
    box: () => where.box,
    takes,
  }

  let pressing = 0

  function onRowTouchStart(event: TouchEvent, entry: Entry) {
    if (!manual) return

    const touch = event.touches.length === 1 ? event.touches[0] : undefined
    const row = event.currentTarget
    if (!touch || !(row instanceof HTMLElement)) {
      endPress()
      return
    }

    const mine = ++pressing
    const at = { x: touch.clientX, y: touch.clientY }
    void liftCode().then((code) => {
      if (pressing === mine) code.touchHeld(held, at, row, entry)
    })
  }

  function endPress() {
    pressing += 1
    lift?.cancelHold()
  }

  function letGo() {
    if (lift) {
      lift.letGo(held)
      return
    }

    workspace.arranged.unshow()
    carrying = []
  }

  $effect(() => () => lift?.dropLift(held))

  $effect(() => {
    listMotion.before = () =>
      new Map(
        [...held.rows()].map((row) => [row.dataset.path ?? '', row.getBoundingClientRect().top]),
      )
    listMotion.after = (was) => {
      if (was) void liftCode().then((code) => code.arrive(held, was))
    }
    return () => {
      listMotion.before = () => null
      listMotion.after = () => undefined
    }
  })

  function takes(entry: Entry, how: 'move' | 'copy' = 'move'): boolean {
    const paths = carried()
    if (paths.includes(entry.path)) return false

    return paths.length === 0 || landsIn(paths, targetFor(entry.path, entry.is_dir), how)
  }

  function nesting(entry: Entry): boolean {
    return dropTarget.lit(entry.is_dir ? entry.path : folderFor(entry.path))
  }

  function overRow(event: DragEvent, entry: Entry) {
    const how = landing(event, shortcuts.platform)
    if (!how) return

    const row = event.currentTarget
    const ordering =
      how === 'move' && row instanceof HTMLElement && !isBookmarkDrag(event.dataTransfer)
    if (lift && ordering && lift.aimAt(held, row, event.clientY, entry)) {
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      dropTarget.clear()
      lift.dwellOver(null, false)
      return
    }

    if (!takes(entry, how)) return

    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = how
    lift?.slideBack(held)
    dropTarget.over(targetFor(entry.path, entry.is_dir))
    lift?.dwellOver(entry.path, entry.is_dir)
  }

  function stillInside(event: DragEvent): boolean {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    return inside(box, event.clientX, event.clientY)
  }

  function drop(event: DragEvent, entry: Entry) {
    event.preventDefault()
    dropTarget.clear()
    lift?.dwellOver(null, false)

    if (workspace.arranged.dragging) {
      workspace.arranged.drop()
      carrying = []
      return
    }

    dropOnList(event, targetFor(entry.path, entry.is_dir))
  }

  function showRowMenu(event: MouseEvent, entry: Entry, title: string) {
    event.preventDefault()
    event.stopPropagation()
    void import('./row-menu').then(({ rowMenu }) => menu.show(event, rowMenu(entry), { title }))
  }

  function openRowAt(event: MouseEvent, entry: Entry) {
    if (onTwist(event)) {
      workspace.toggleFolder(entry.path)
      return
    }

    if (!pick(event, entry)) void workspace.openRow(entry.path, { preview: true })
  }

  $effect(() => {
    const ul = list
    if (!ul) return

    const root = workspace.activeSpace?.root

    const stop = where.follow(ul, rowOf, (box) => {
      if (root !== undefined) workspace.device.setListAt(root, box.scrollTop)
    })

    const box = where.box
    if (!box) return stop

    if (root !== undefined) {
      box.scrollTop = untrack(() => workspace.device.listAt(root))
      where.refresh()
    }

    box.addEventListener('dragover', onDragOver)
    box.addEventListener('dragleave', offList)
    box.addEventListener('drop', stopRolling)
    box.addEventListener('dragend', stopRolling)

    return () => {
      stop?.()
      box.removeEventListener('dragover', onDragOver)
      box.removeEventListener('dragleave', offList)
      box.removeEventListener('drop', stopRolling)
      box.removeEventListener('dragend', stopRolling)
      stopRolling()
    }
  })

  let edgeAt: number | null = null
  let rolling: number | null = null

  function rollOn() {
    const box = where.box
    if (!box || edgeAt === null) {
      rolling = null
      return
    }

    const step = autoScrollBy(edgeAt, box.clientHeight, rowHeight, rowHeight / 2)
    if (step !== 0) box.scrollTop += step

    rolling = requestAnimationFrame(rollOn)
  }

  function onDragOver(event: DragEvent) {
    const box = where.box
    if (!box || !landing(event, shortcuts.platform)) return

    edgeAt = event.clientY - box.getBoundingClientRect().top
    rolling ??= requestAnimationFrame(rollOn)
  }

  function offList(event: DragEvent) {
    const box = where.box
    if (box && inside(box.getBoundingClientRect(), event.clientX, event.clientY)) return

    stopRolling()
  }

  function stopRolling() {
    edgeAt = null
    if (rolling !== null) cancelAnimationFrame(rolling)
    rolling = null
  }

  function blockMoved(was: string[], now: string[]): { at: number; rows: number } | null {
    const grew = now.length - was.length
    if (grew === 0) return null

    const [fewer, more] = grew > 0 ? [was, now] : [now, was]
    const many = Math.abs(grew)

    let head = 0
    while (head < fewer.length && fewer[head] === more[head]) head += 1
    for (let rest = head; rest < fewer.length; rest++) {
      if (fewer[rest] !== more[rest + many]) return null
    }

    return { at: head, rows: many }
  }

  let wasPaths: string[] = []
  let wasRows: FlatRow[] = []
  let wasIds: string[] = []
  let sliding: number | null = null

  function slide(twist: number, many: number, shutting: boolean, keep: FlatRow[]) {
    if (sliding !== null) cancelAnimationFrame(sliding)

    const ms = dur(FOLDING)
    if (ms === 0) {
      fold = null
      frozen = null
      return
    }

    if (shutting) frozen = keep
    const started = performance.now()

    const step = (now: number) => {
      const along = Math.min(1, (now - started) / ms)
      const eased = cubicOut(along)
      const out = shutting ? 1 - eased : eased
      fold = { at: twist, rows: many, grown: many * out }

      if (along < 1) {
        sliding = requestAnimationFrame(step)
        return
      }

      sliding = null
      fold = null
      frozen = null
    }

    fold = { at: twist, rows: many, grown: shutting ? many : 0 }
    sliding = requestAnimationFrame(step)
  }

  $effect.pre(() => {
    const now = live
    const paths = now.map((one) => one.entry.path)
    const before = wasRows
    const beforeIds = wasIds
    const nowIds = now.map((one) => rowIds.idOf(one.entry.path))
    const moved = blockMoved(wasPaths, paths)

    wasPaths = paths
    wasRows = now
    wasIds = nowIds

    untrack(keepFocus)
    if (twisted(moved, before, now)) return
    untrack(() => settleRows(beforeIds, nowIds))
  })

  function twisted(
    moved: { at: number; rows: number } | null,
    before: FlatRow[],
    now: FlatRow[],
  ): boolean {
    if (!moved || moved.at < 1) return false

    const opening = now.length > before.length
    const twist = (opening ? now : before)[moved.at - 1]
    if (!twist?.entry.is_dir) return false
    if (workspace.isExpanded(twist.entry.path) !== opening) return false
    if (heldRows(twist.entry, isOpen) !== moved.rows) return false

    slide(moved.at - 1, moved.rows, !opening, before)
    return true
  }

  function keepFocus() {
    const had = document.activeElement
    if (!(had instanceof HTMLElement) || !list?.contains(had)) return
    void tick().then(() => {
      const now = document.activeElement
      if (!had.isConnected || now === had || (now !== null && now !== document.body)) return
      had.focus({ preventScroll: true })
    })
  }

  function settleRows(was: string[], now: string[]) {
    const box = where.box
    if (!list || !box || fold !== null || frozen !== null) return
    if (carrying.length || workspace.arranged.dragging) return
    if (workspace.activeSpace?.root !== listed) return
    settle(was, now, { list, box, row: rowHeight, top: where.top, refresh: () => where.refresh() })
  }

  $effect(() => () => {
    if (sliding !== null) cancelAnimationFrame(sliding)
  })

  function rowOfNote(note: string): number | null {
    const own = at.get(note)
    if (own !== undefined) return own
    if (!isFolderNote(note)) return null

    return at.get(folderOf(note)) ?? null
  }

  let showing: string | null = null

  let opened = false

  let listed = untrack(() => workspace.activeSpace?.root)

  $effect.pre(() => {
    const root = workspace.activeSpace?.root
    if (root === listed) return
    listed = root

    standing = null
    reaching = null
    wrong = false
    wasRows = untrack(() => live)
    wasPaths = wasRows.map((one) => one.entry.path)
    wasIds = wasRows.map((one) => rowIds.idOf(one.entry.path))
    showing = untrack(() => workspace.active?.path ?? null)
    showingId = showing === null ? undefined : rowIds.peek(showing)
    opened = true
  })

  let showingId: string | undefined

  $effect(() => {
    const note = workspace.active?.path ?? null
    if (note === showing) return
    const was = showingId
    showing = note
    showingId = note === null ? undefined : rowIds.peek(note)
    if (was !== undefined && showingId === was) return

    if (!opened) {
      opened = true
      return
    }

    const index = note === null ? null : rowOfNote(note)
    const row = index === null ? undefined : flat[index]
    if (!row || !workspace.isSelected(row.entry.path)) workspace.clearSelection()
    if (index === null) return

    void reach(index)
  })

  $effect(() => {
    const asked = workspace.revealing
    if (asked === null) return

    const index = rowOfNote(asked)
    if (index === null) return

    workspace.revealing = null
    void reach(index)
  })

  let naming: string | null = null

  $effect(() => {
    const path = workspace.naming?.path ?? null
    if (path === naming) return
    naming = path
    if (path === null) return

    const index = at.get(path)
    if (index === undefined) return

    void reach(index)
  })

  function onFocus(event: FocusEvent) {
    const from = event.target instanceof Element ? event.target.closest('.row') : null
    const path = from instanceof HTMLElement ? (from.dataset.path ?? null) : null
    const index = path === null ? undefined : at.get(path)
    standing = index === undefined ? null : (ids[index] ?? null)
    keyedOn = false
    standingAt = index ?? -1
    standingPath = path ?? ''
  }

  function movedOn() {
    if (!keyedOn || overlays.depth > 0) return
    keyedOn = false
    if (!list?.contains(document.activeElement)) standing = null
  }

  function onBlur(event: FocusEvent) {
    const to = event.relatedTarget
    if (to instanceof Node && list?.contains(to)) return
    if (keyedOn) return
    standing = null
  }
</script>

<svelte:window onkeydowncapture={movedOn} onpointerdowncapture={movedOn} />

<ul
  bind:this={list}
  role="tree"
  aria-label={t('Files')}
  aria-multiselectable="true"
  onkeydown={onKey}
  onfocusin={onFocus}
  onfocusout={onBlur}
  use:roving={{
    rows: '.row',
    keyOf: walkKey,
    sideways,
    open: openRow,
    peek: peekRow,
    menu: (row, to) => {
      keyedOn = true
      row.dispatchEvent(to)
    },
    leave: leaveList,
    long: {
      count: () => flat.length,
      indexOf: (row) => (row.dataset.path === undefined ? -1 : (pathAt(row.dataset.path) ?? -1)),
      labels: () => flat.map((one) => labelOf(one.entry)),
      reach,
    },
  }}
>
  <li class="gap" style:height="{view.above}px" aria-hidden="true"></li>

  {#each drawn as one (slots.get(one.id) ?? one.id)}
    {@render line(one)}
  {/each}

  <li class="gap" style:height="{view.below}px" aria-hidden="true"></li>
</ul>

{#snippet line(one: Drawn)}
  {@const cut = fold === null || one.away ? rowHeight : heightOf(one.index, rows)}
  <li
    data-row={one.index}
    data-id={one.id}
    class:away={one.away}
    class:cut={cut < rowHeight}
    style:top={one.away ? `${offsetOf(one.index, rows)}px` : undefined}
    style:height={cut < rowHeight ? `${cut}px` : undefined}
    role="none"
  >
    {@render inner(one.row, one.index)}
  </li>
{/snippet}

{#snippet inner(one: FlatRow, index: number)}
  {@const entry = one.entry}
  {@const depth = one.depth}
  {@const own = folderNote(entry)}
  {@const nested = own ? nestedIn(entry) : entry.children}
  {@const unwritten = entry.is_dir && !own}
  {@const opens = own?.path ?? (entry.is_dir ? folderNotePath(entry.path) : entry.path)}
  {@const name = labelOf(entry)}
  {@const named = workspace.naming}
  {#if named?.path === entry.path}
    <div
      class="nib-row row"
      class:is-quiet={unwritten}
      class:is-on={workspace.active?.path === opens}
      class:is-picked={workspace.isSelected(entry.path)}
      class:is-wrong={wrong}
      style:--level={depth}
    >
      <FileMark mark={markOf(entry, own)} path={markPath(entry, own)} />
      <NameField
        value={nameToEdit(entry)}
        extension={named.making === 'database' ? '' : extensionOf(entry.name, entry.is_dir)}
        current={named.making ? undefined : entry.name}
        taken={workspace.namesBeside(entry.path)}
        space={workspace.activeSpace?.root}
        appending={named.appending}
        bind:wrong
        oncommit={(typed: string) => commit(entry, own, typed)}
        oncancel={() => workspace.cancelNaming()}
      />
      {#if nested.length}{@render twist(entry)}{/if}
    </div>
  {:else}
    <button
      class="nib-row row"
      data-path={entry.path}
      class:is-left-out={workspace.excluded.has(entry.path)}
      class:is-cut={fileClipboard.isCut(entry.path)}
      class:is-quiet={unwritten}
      class:is-taking={nesting(entry)}
      class:is-lifted={carrying.includes(entry.path)}
      class:is-on={workspace.active?.path === opens}
      class:is-picked={workspace.isSelected(entry.path)}
      style:--level={depth}
      role="treeitem"
      aria-level={depth + 1}
      aria-setsize={among[index]?.size}
      aria-posinset={among[index]?.position}
      aria-selected={workspace.isSelected(entry.path)}
      aria-expanded={entry.is_dir ? standsOpen(entry, isOpen) : undefined}
      draggable="true"
      onclick={(event) => openRowAt(event, entry)}
      ondblclick={(event) =>
        !onTwist(event) && tabAsk(event) === 'plain' && workspace.openRow(entry.path)}
      use:middleOpens={(event) =>
        onTwist(event) || void workspace.openRow(entry.path, howFor(tabAsk(event)))}
      oncontextmenu={(event) => showRowMenu(event, entry, name)}
      use:longPress={(event) => showRowMenu(event, entry, name)}
      ontouchstart={(event) => onRowTouchStart(event, entry)}
      ontouchmove={(event) => lift?.touchMoved(event)}
      ontouchend={endPress}
      ontouchcancel={endPress}
      ondragstart={(event) => startDrag(event, entry.path)}
      ondragend={endDrag}
      ondragenter={(event) => overRow(event, entry)}
      ondragover={(event) => overRow(event, entry)}
      ondragleave={(event) => stillInside(event) || dropTarget.clear()}
      ondrop={(event) => drop(event, entry)}
      onpointerenter={() => entry.evicted && keptAway.ahead(entry.path)}
    >
      <FileMark mark={markOf(entry, own)} path={markPath(entry, own)} />
      <span class="nib-row-label">{name}</span>
      {#if !__EVEN_PLUGIN__ && entry.evicted}
        {#await import('./CloudMark.svelte') then mark}<mark.default path={entry.path} />{/await}
      {/if}
      {#if othersIn(opens)}<SharedMark label={t('Also open elsewhere')} />
      {:else if isSharedItem(opens)}<SharedMark />{/if}
      {#if workspace.protection.any && workspace.activeSpace && workspace.protection.own(workspace.activeSpace.root, entry.path)}<SharedMark
          label={t('Protected')}
          icon={LOCK_MARK}
        />{/if}
      {#if syncMark.asked}{#await syncMark.asked then Held}<Held path={opens} />{/await}{/if}
      {#if nested.length}{@render twist(entry)}{/if}
    </button>
  {/if}
{/snippet}

{#snippet twist(entry: Entry)}
  <span class="nib-row-meta twist">
    <Twist open={standsOpen(entry, isOpen)} />
  </span>
{/snippet}

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    position: relative;
    overflow-anchor: none;
  }

  .gap {
    pointer-events: none;
  }

  .cut {
    overflow: hidden;
  }

  .away {
    position: absolute;
    left: 0;
    right: 0;
  }

  .row.is-lifted {
    opacity: 0.35;
  }

  :global(.row.carried) {
    position: fixed;
    z-index: var(--z-carried);
    pointer-events: none;
    border-radius: var(--radius-sm);
    background: var(--surface);
    box-shadow: var(--shadow-md, 0 6px 16px rgb(0 0 0 / 0.22));
    opacity: 0.95;
  }

  .row.is-left-out {
    opacity: 0.5;
  }

  .row.is-cut {
    opacity: 0.5;
  }

  .row {
    padding-inline-start: calc(var(--row-pad) + var(--level, 0) * var(--row-indent));
  }

  .twist {
    position: relative;
    align-self: stretch;
    display: grid;
    place-items: center;
    padding: 0 var(--space-1);
  }

  .twist::before {
    content: '';
    position: absolute;
    inset-block: 0;
    inset-inline: calc(-1 * var(--space-1)) calc(-1 * var(--row-pad));
  }

  :global([data-touch]) .twist::before {
    inset-inline-start: min(
      calc(-1 * var(--space-1)),
      calc(var(--icon-sm) + 2 * var(--space-1) + var(--row-pad) - var(--touch-target))
    );
  }

  .twist :global(svg) {
    width: var(--icon-sm);
    height: var(--icon-sm);
  }

  .row.is-on :global(.mark) {
    stroke: var(--accent);
    opacity: 1;
  }
</style>
