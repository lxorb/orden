import { isPagesTarget, isPdfTarget } from '@orden/markdown/links'
import { breathe } from '../../breathe'
import { holderOf } from '../../pages/held'
import { pathKey, invoke } from '../../platform/src/api'
import { startup } from '../../startup.svelte'
import { mark } from '../../trace'
import type { Entry } from '@orden/contracts'
import { openDocument, textOf } from './document'
import { paperOpened, paperRead, papersFor, papersListed, type Walked, writePapers } from './papers'
import { paperText } from './text-cache'

const PAGES = 400

let reading: string | null = null

function sparing(): boolean {
  const connection = (navigator as { connection?: { saveData?: boolean } }).connection
  return connection?.saveData === true
}

export function walkedOf(root: string, tree: Entry): Walked {
  const notes: string[] = []
  const folders: string[] = [root]
  const walk = (entry: Entry) => {
    for (const child of entry.children) {
      if (!child.is_dir) {
        if (isPagesTarget(child.name)) notes.push(child.path)
      } else if (!child.unlisted) {
        folders.push(child.path)
        walk(child)
      }
    }
  }
  walk(tree)
  return { notes, folders }
}

export async function readPapers(
  root: string,
  files: readonly Entry[],
  tree: Entry | null,
): Promise<void> {
  reading = root
  const papers = files.filter((one) => isPdfTarget(one.name))
  const stamps = new Map(papers.map((one) => [one.path, one.modified]))
  const notes = tree ? walkedOf(root, tree) : null

  papersListed(root, stamps, notes)

  await startup.turn('search')
  if (reading !== root) return

  if (files.some((one) => isPagesTarget(one.name))) {
    const held = await heldPapers(root, files)
    if (reading !== root) return
    for (const one of held) stamps.set(one.path, one.modified)
    if (held.length) papersListed(root, stamps, notes)
    papers.push(...held)
  }

  mark(`papers: ${papers.length} in the space`)
  await papersFor(root)
  if (reading !== root || sparing()) return

  for (const paper of papers) {
    if (reading !== root) return

    if (await paperText(paper.path, paper.modified)) continue

    await readOne(paper)
    await writePapers()
    await breathe()
  }

  mark('papers read')
}

export async function heldPapers(root: string, files: readonly Entry[]): Promise<Entry[]> {
  const notes = new Set(
    files.filter((one) => isPagesTarget(one.name)).map((one) => pathKey(one.path)),
  )
  const tree = await invoke<Entry>('read_tree', { root, options: { papers: true } }).catch(
    () => null,
  )
  const out: Entry[] = []
  const walk = (entry: Entry) => {
    for (const child of entry.children) {
      const holder = holderOf(child.path)
      if (holder && notes.has(pathKey(holder))) out.push(child)
      if (child.is_dir) walk(child)
    }
  }
  if (tree) walk(tree)
  return out
}

async function readOne(paper: Entry): Promise<void> {
  const held = await openDocument(paper.path).catch(() => null)
  if (!held) return

  try {
    paperOpened(paper.path, held.hash, paper.modified)

    const pages = Math.min(held.doc.numPages, PAGES)
    for (let number = 1; number <= pages; number++) {
      if (reading === null) return

      const page = await held.doc.getPage(number)
      paperRead(paper.path, number, await textOf(page))
      page.cleanup()
      await breathe()
    }
  } catch {
    // A paper that falls apart half way through has the pages it gave up until
    // then, which is more than it had before.
  } finally {
    await held.close()
  }
}
