import { isCanvasTarget, isPagesTarget, isWebTarget } from '@orden/markdown/links'
import type { AgentAnswer } from '../../automation/caller'
import { shownName, onDisk as exists, nameOf } from '../../platform/src/api'
import { pairOf } from '../../pages/held'
import { canWriteAt } from '../../sharing.svelte'
import { isWebAddress } from '../../web-tab/address'
import { workspace } from '../../workspace.svelte'
import { fileNamed } from '../../workspace/drafts'
import { asked } from './asks'
import { type Call, done, flag, maybe, need, text } from './call'
import { Refused } from './problem'
import { judgedForWriting, onDisk, type Place } from './spaces'

const FILE_KINDS = ['note', 'canvas', 'pages', 'web'] as const
type FileKind = (typeof FILE_KINDS)[number]

export function fileKindOf(call: Call): FileKind {
  const path = need(call, 'path')
  if (isCanvasTarget(path)) return 'canvas'
  if (isPagesTarget(path)) return 'pages'
  if (isWebTarget(path)) return 'web'

  const kind = maybe(call, 'kind') ?? 'note'
  const found = FILE_KINDS.find((one) => one === kind)
  if (!found) throw new Refused('bad_arguments', `kind is one of ${FILE_KINDS.join(', ')}`)

  return found
}

async function firstWords(call: Call, kind: Exclude<FileKind, 'note'>, name: string) {
  switch (kind) {
    case 'canvas': {
      const { blankCanvas, readCanvas, writeCanvas } = await import('../../canvas/format')
      const sent = text(call, 'content')
      return sent?.trim() ? writeCanvas(readCanvas(sent)) : blankCanvas()
    }

    case 'pages': {
      const { blankPages } = await import('@orden/markdown/pages')
      const { modes } = await import('../../modes.svelte')
      return blankPages(modes.pagesPaper)
    }

    case 'web': {
      const url = maybe(call, 'url')
      if (url === null || !isWebAddress(url)) {
        throw new Refused('bad_arguments', 'a web note says its url, a web address')
      }
      const { writeShortcut } = await import('@orden/scan/shortcut')
      return writeShortcut(url, shownName(name), new Date())
    }
  }
}

export async function createFile(
  call: Call,
  place: Place,
  kind: Exclude<FileKind, 'note'>,
  make: (place: Place, relative: string, words: string, open: Call | null) => Promise<object>,
): Promise<AgentAnswer> {
  const relative = fileNamed(judgedForWriting(need(call, 'path')), kind)
  const path = onDisk(place, relative)
  if (!canWriteAt(path)) {
    throw new Refused('read_only', `${place.space.name} is shared with you to read`)
  }
  if ((await workspace.noteText(path)) !== null) {
    throw new Refused('exists', `${relative} is already there, and nothing is written over`)
  }
  const paper = pairOf(path)
  if (paper !== null && (await exists(paper))) {
    throw new Refused(
      'exists',
      `${nameOf(paper)} is already there, and would be taken for its paper`,
    )
  }

  const words = await firstWords(call, kind, nameOf(relative))
  const question = await asked(call, null, `Make ${relative} in ${place.space.name}`)
  if (question) return question

  return done({
    ...(await make(place, relative, words, flag(call, 'open') ? call : null)),
    space: place.space.id,
  })
}
