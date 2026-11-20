import { type NoteIndex, type NoteRef, resolveFile, resolveNote, resolveRelative } from '@orden/editor'
import { oneEdit } from '@orden/markdown/edits'
import {
  isCanvasTarget,
  isPagesTarget,
  isTabFile,
  type LinkKind,
  parseWikilink,
  sectionOf,
  type Wikilink,
} from '@orden/markdown/links'
import type { ScannedNote } from '@orden/scan/note'
import type { OpenNote } from '@orden/contracts'
import {
  breathe,
  folderOf,
  insideSpace,
  keepVersion,
  log,
  nameOf,
  oneWriteAt,
  samePath,
  writeInTurn,
} from '../../platform/src/api'
import { type Placed, retargetLinks } from './link-rewrite'
import {
  BREATHE_EVERY,
  carried,
  comparable,
  hearing,
  namesOf,
  nothing,
  refOf,
  type Retargeting,
  stillReaches,
  wordsOf,
} from './links.svelte'
import { services } from './services'

type Fragment = Pick<Wikilink, 'heading' | 'block'>
const WHOLE: Fragment = { heading: null, block: null }
const fragmentOf = (subpath: string | undefined): Fragment => (subpath ? parseWikilink(`_${subpath}`) : null) ?? WHOLE
export async function retargetIn(
  notes: readonly ScannedNote[],
  resolve: (source: string, link: { kind: LinkKind; target: string }) => string | null,
  rewritten: (note: ScannedNote, after: string) => void,
  asked: {
    was: string
    now: string
    root: string
    open: (path: string) => OpenNote | null
    how: Retargeting
    files: readonly string[]
    listed?: (path: string) => ScannedNote | undefined
  },
): Promise<number> {
  const { was, now, root, open, how, files, listed } = asked
  const { moved = false, only, touched: told, part } = how
  const name = comparable(nameOf(was))
  const moving = part === undefined ? carried(was, now) : () => null
  const toward = (path: string, link: Fragment): string | null =>
    part === undefined
      ? moving(path)
      : path === was && (link.heading !== null || link.block !== null) && sectionOf(part, link) !== null
        ? now
        : null
  const cardTo = (path: string, subpath?: string) => toward(path, fragmentOf(subpath))
  const movingNames = new Set(
    [...notes.map((one) => one.path), ...files]
      .filter((path) => moving(path) !== null)
      .map((path) => comparable(nameOf(path))),
  )
  const arrivingNames = new Set(
    [...notes.map((one) => one.path), ...files]
      .map(moving)
      .filter((path) => path !== null)
      .map((path) => comparable(nameOf(path))),
  )
  const movingAliases = new Set(
    notes
      .filter((one) => moving(one.path) !== null)
      .flatMap((one) => one.aliases.map((alias) => comparable(alias.trim()))),
  )
  let after: NoteIndex | null = null
  const afterMove = (): NoteIndex =>
    (after ??= {
      notes: notes.map((one) => ({ ...refOf(one), path: moving(one.path) ?? one.path })),
      files: files.map((path) => moving(path) ?? path),
      path: null,
      read: nothing,
    })
  const lastOf = (link: { target: string }) => comparable(link.target).split('/').at(-1) ?? ''
  const named = (link: { target: string }) => {
    if (!link.target) return false
    const parts = comparable(link.target).split('/')
    return (
      parts.includes(name) ||
      movingNames.has(lastOf(link)) ||
      arrivingNames.has(lastOf(link)) ||
      movingAliases.has(comparable(link.target))
    )
  }
  let namedAfter: Map<string, NoteRef[]> | null = null
  const unionsAfter = new Map<string, NoteRef[]>()
  const calledAfterMove = (written: string): NoteRef[] => {
    if (!namedAfter) {
      namedAfter = new Map<string, NoteRef[]>()
      for (const ref of afterMove().notes) {
        for (const key of namesOf(ref)) {
          const held = namedAfter.get(key)
          if (held) held.push(ref)
          else namedAfter.set(key, [ref])
        }
      }
    }
    const whole = comparable(written)
    const last = whole.split('/').at(-1) ?? ''
    const byLast = namedAfter.get(last) ?? []
    const byWhole = whole === last ? [] : (namedAfter.get(whole) ?? [])
    if (!byWhole.length) return byLast
    const held = unionsAfter.get(whole)
    if (held) return held
    const both = [...new Set([...byLast, ...byWhole])]
    unionsAfter.set(whole, both)
    return both
  }
  const filesAfter = new Map<string, string[]>()
  const reaching =
    (source: string, there: string, kind: LinkKind = 'wikilink') =>
    (written: string): boolean => {
      const key = comparable(nameOf(there))
      let called = filesAfter.get(key)
      if (!called) {
        called = afterMove().files.filter((path) => comparable(nameOf(path)) === key)
        filesAfter.set(key, called)
      }
      const index: NoteIndex = {
        notes: calledAfterMove(written),
        files: called,
        path: source,
        read: nothing,
      }
      const note = isTabFile(written)
        ? null
        : kind === 'markdown'
          ? resolveRelative(index, written)
          : resolveNote(index, written)
      return (note?.path ?? resolveFile(index, written, kind)) === there
    }
  let touched = 0
  let walked = 0
  for (const note of [...notes]) {
    if (++walked % BREATHE_EVERY === 0) await breathe()
    if (only && !only.some((path) => samePath(path, insideSpace(root, note.path)))) continue
    const went = moved ? moving(note.path) : null
    const source = went ?? note.path
    const shifted = went !== null && folderOf(went) !== folderOf(note.path)
    const answered = new Map<string, string | Placed | null>()
    const to = (link: { kind: LinkKind; target: string } & Fragment): string | Placed | null => {
      const key = `${link.kind}\0${link.target}\0${link.heading}\0${link.block}`
      const held = answered.get(key)
      if (held !== undefined) return held
      const there = whereNow(link)
      answered.set(key, there)
      return there
    }
    const whereNow = (link: { kind: LinkKind; target: string } & Fragment): string | Placed | null => {
      const found = resolve(note.path, link)
      if (found === null) return null
      const last = link.target.replace(/\\/g, '/').split('/').pop() ?? ''
      const there = toward(found, link) ?? found
      if (link.kind === 'wikilink' && comparable(last) !== comparable(nameOf(found))) {
        const arriving = arrivingNames.has(lastOf(link)) || movingAliases.has(comparable(link.target))
        if (there === found && !shifted && !arriving) return null
        const reaches = reaching(source, there)
        if (reaches(link.target)) return null
        return { path: there, reaches, shown: link.target }
      }
      if (there === found && !shifted) {
        if (!arrivingNames.has(lastOf(link))) return null
        const reaches = reaching(source, there, link.kind)
        if (reaches(link.target)) return null
        return link.kind === 'wikilink' ? { path: there, reaches } : there
      }
      if (link.kind === 'wikilink') {
        const reaches = reaching(source, there)
        return reaches(link.target) ? null : { path: there, reaches }
      }
      const kept = nameOf(there) === nameOf(found)
      const reaches = shifted
        ? stillReaches(source, link, there, kept)
        : kept && reaching(source, there, 'markdown')(link.target)
      if (reaches) return null
      return there
    }
    const plane = isCanvasTarget(note.path) || isPagesTarget(note.path)
    const rewrite = plane ? await import('./canvas-rewrite') : null
    const card = rewrite?.cardsMoving(note.path, cardTo) ?? null
    const worth = plane || note.links.some((link) => (named(link) || shifted) && to(link) !== null)
    if (!worth) continue
    const absolute = insideSpace(root, note.path)
    const target = went === null ? absolute : insideSpace(root, went)
    const doc = open(absolute)
    const drawn = doc && rewrite && !isPagesTarget(note.path) ? await services().plane(doc) : null
    let read = listed?.(note.path) ?? note
    const drawing = { relinked: false, before: '' }
    const file = card ?? cardTo
    const fresh = async () => {
      const before = await wordsOf(absolute, target, open)
      if (before === null) return null
      drawing.before = before
      read = listed?.(note.path) ?? note
      const words = rewrite ? rewrite.retargetCanvas(before, source, file, to) : retargetLinks(before, source, to)
      return words === null || words === before ? null : { before, words }
    }
    const keepIt = (before: string) => keepVersion(target, before)
    const refused = (error: unknown) => {
      log('warn', `a link in ${target} could not be rewritten: ${String(error)}`)
      return null
    }
    const after = doc
      ? await (async () => {
          const got = await fresh()
          if (!got) return null
          const { before } = got
          let { words } = got
          const knew = doc.onDisk
          drawing.relinked =
            drawn !== null &&
            rewrite !== null &&
            drawn.relinked((canvas) => rewrite.retargetPlane(canvas, source, file, to))
          if (drawing.relinked) words = doc.text
          else {
            const edit = oneEdit(before, words)
            if (edit) doc.edited([edit], words)
          }
          return doc.writeTo(target, words, knew, () => keepIt(before))
        })().catch(refused)
      : await oneWriteAt(target, async () => {
          const got = await fresh()
          if (!got) return null
          const { before, words } = got
          const late = open(absolute)
          const edit = oneEdit(before, words)
          if (late && edit) late.edited([edit], words)
          await keepIt(before)
          await writeInTurn(target, words, false)
          return words
        }).catch(refused)
    if (after === null) continue
    if (drawing.relinked) doc?.wroteAs(after)
    for (const hear of hearing) hear(target, after, false)
    told?.push(target)
    how.wrote?.push({ path: target, before: drawing.before, after })
    rewritten(read, after)
    touched++
  }
  return touched
}
