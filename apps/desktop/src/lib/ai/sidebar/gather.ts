import { protection } from '../../protect/src/api'
import { searchSpace } from '../../search/space'
import { parseQuery } from '@orden/scan/search/query'
import { pad } from '../../scratchpad/src/api'
import { insideSpace, relativeTo, within, withinSpace } from '../../platform/src/api'
import { pages } from '../../web-tab/pages.svelte'
import { workspace } from '../../workspace.svelte'
import { readThread } from '../chat/threads'
import { readOutside, sinceCompaction } from '../chat/transcript'
import { fromOthers, fromOthersIn } from '../commands/found'
import type { Attachment, Draft, Mode } from '../chat/types'
import { fitted, retrieve } from '../retrieve'
import { passageAttachments } from './citations'
import type { Mention } from './mentions'

const NOTE = 12_000
const PAGE = 8_000
const SELECTION = 4_000
const THREAD = 3_000
const LISTED = 200

export interface Picked {
  path: string | null
  shared: string | null
}

async function pickedFromOthers(picked: Picked | null): Promise<boolean> {
  const active = workspace.active
  const from = picked ?? (active ? { path: active.path, shared: active.note.shared } : null)
  if (from?.shared != null) return true
  if (from?.path) return await fromOthers(from.path)
  const open = workspace.activeSpace?.root
  return !!open && (await fromOthersIn(open))
}

export interface Front {
  path: string
  name: string
  text: string
}

async function markedFrom(
  one: Attachment | null,
  paths: readonly string[],
): Promise<Attachment | null> {
  if (!one) return null
  const theirs = await Promise.all(paths.map((path) => fromOthers(path)))
  return theirs.includes(true) ? { ...one, untrusted: true } : one
}

const agentsMay = (path: string) => protection.agentsMay(path)

async function noteAttachment(root: string, path: string): Promise<Attachment | null> {
  if (!agentsMay(path)) return null
  const text = await workspace.noteText(path)
  if (text === null) return null
  return await markedFrom({ label: relativeTo(root, path), text: fitted(text, NOTE) }, [path])
}

function listed(root: string, paths: readonly string[]): string {
  return paths.map((one) => `- ${relativeTo(root, one)}`).join('\n')
}

async function tagged(root: string, tag: string): Promise<string[]> {
  const found = new Set<string>()
  await searchSpace(
    root,
    parseQuery(`tag:${tag}`),
    [],
    LISTED,
    (batch) => {
      for (const hit of batch.hits) if (agentsMay(hit.path)) found.add(hit.path)
    },
    workspace.leftOutOf(root),
  ).catch(() => undefined)
  return [...found]
}

async function pageAttachment(tabId: string, label: string): Promise<Attachment | null> {
  const read = await pages.read(tabId, true).catch(() => null)
  if (!read?.html.trim()) return null
  const { htmlToMarkdown } = await import('@orden/markdown/from-html')
  return {
    label: read.title || label,
    text: fitted(htmlToMarkdown(read.html).trim(), PAGE),
    untrusted: true,
  }
}

async function threadAttachment(
  space: string,
  id: string,
  label: string,
): Promise<Attachment | null> {
  const thread = await readThread(space, id).catch(() => null)
  if (!thread) return null
  const words = [
    thread.compaction?.summary ?? '',
    ...sinceCompaction(thread.turns, thread.compaction).map((turn) =>
      turn.role === 'you'
        ? `> ${turn.draft?.text ?? ''}`
        : turn.parts.flatMap((part) => (part.kind === 'text' ? [part.text] : [])).join(''),
    ),
  ]
    .filter(Boolean)
    .join('\n\n')
  return {
    label,
    text: fitted(words, THREAD),
    ...(readOutside(thread.turns) ? { untrusted: true } : {}),
  }
}

async function attachmentOf(
  chip: Mention,
  space: { id: string; root: string },
  selection: string,
  picked: Picked | null,
): Promise<Attachment | null> {
  const { root } = space
  switch (chip.kind) {
    case 'note':
      return await noteAttachment(root, chip.id)
    case 'folder': {
      const paths = workspace.notes
        .map((one) => one.path)
        .filter((one) => within(chip.id, one, root))
        .slice(0, LISTED)
      return await markedFrom(
        { label: `${relativeTo(root, chip.id)}/`, text: listed(root, paths) },
        paths,
      )
    }
    case 'tag': {
      const paths = (await tagged(root, chip.id)).slice(0, LISTED)
      return await markedFrom({ label: `#${chip.id}`, text: listed(root, paths) }, paths)
    }
    case 'tab':
      return await pageAttachment(chip.id, chip.label)
    case 'selection': {
      if (!selection.trim() || !agentsMay(workspace.active?.path ?? '')) return null
      const one = { label: 'selection', text: fitted(selection, SELECTION) }
      return (await pickedFromOthers(picked)) ? { ...one, untrusted: true } : one
    }
    case 'scratchpad': {
      const path = await pad()
        .then((scratchpad) => scratchpad.where())
        .catch(() => '')
      const text = path ? await workspace.noteText(path) : null
      return text
        ? await markedFrom({ label: 'scratchpad', text: fitted(text, NOTE) }, [path])
        : null
    }
    case 'thread':
      return await threadAttachment(chip.space ?? space.id, chip.id, chip.label)
    case 'picture':
      return chip.image ? { label: chip.label, image: chip.image } : null
    case 'words':
      if (!chip.text) return null
      if (chip.theirs) return { label: chip.label, text: fitted(chip.text, NOTE), untrusted: true }
      return await markedFrom(
        { label: chip.label, text: fitted(chip.text, NOTE) },
        chip.from ? [chip.from] : [],
      )
    case 'web':
      return null
  }
}

export async function draftOf(
  text: string,
  chips: readonly Mention[],
  mode: Mode,
  front: Front | null,
  selection: string,
  space: { id: string; root: string } | null,
  picked: Picked | null = null,
): Promise<Draft> {
  const attachments: Attachment[] = []
  if (space) {
    if (front && !agentsMay(insideSpace(space.root, front.path))) front = null
    if (mode === 'approve') {
      const root = space.root
      const passages = await retrieve(
        text,
        {
          root,
          excluded: [...workspace.leftOutOf(root), ...(front ? [] : frontPath(root))],
          relative: (path) => withinSpace(root, path),
          read: (path) => (agentsMay(path) ? workspace.noteText(path) : Promise.resolve(null)),
        },
        front,
      ).catch(() => [])
      const cited = passageAttachments(passages)
      const theirs = await Promise.all(
        cited.map((one) => fromOthers(insideSpace(root, one.cite.path))),
      )
      attachments.push(...cited.map((one, at) => (theirs[at] ? { ...one, untrusted: true } : one)))
    } else if (front) {
      const one = { label: front.path, text: fitted(front.text, NOTE) }
      attachments.push((await markedFrom(one, [insideSpace(space.root, front.path)])) ?? one)
    }
    const read = await Promise.all(
      chips.map((chip) => attachmentOf(chip, space, selection, picked)),
    )
    attachments.push(...read.filter((one): one is Attachment => one !== null))
  }
  return { text, attachments, ...(chips.some((one) => one.kind === 'web') ? { web: true } : {}) }
}

function frontPath(root: string): string[] {
  const tab = workspace.panelTab
  const path = tab?.kind === 'note' && tab.path ? withinSpace(root, tab.path) : null
  return path === null ? [] : [path]
}
