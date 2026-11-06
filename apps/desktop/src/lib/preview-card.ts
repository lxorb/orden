import { createEditor, EditorView, modeEffects, type PreviewNote } from '@orden/editor'
import { frontMatterBlock } from '@orden/markdown/front-matter'
import { pickedLink } from './composer'
import { links } from './link-index.svelte'
import { modes } from './modes.svelte'
import { notePicture } from './note-images'
import { canWriteAt, trustsHtmlAt } from './sharing.svelte'
import { shortcuts } from './shortcuts.svelte'
import { insideSpace } from './space-paths'
import { followHref } from './open-link'
import { workspace } from './workspace.svelte'

const SETTLES_AFTER = 900

export function mountPreview(
  host: HTMLElement,
  note: PreviewNote,
  from: string | null = null,
): (() => void) | null {
  const root = workspace.rootHolding(from)
  if (root === null) return null

  const path = insideSpace(root, note.path)
  const locked = note.readOnly || !canWriteAt(path)

  let said = note.text
  let typed = false
  let settling: ReturnType<typeof setTimeout> | undefined

  const write = async () => {
    settling = undefined
    if (!typed || locked) return
    const after = said
    const before = await workspace.noteText(path)
    if (before === null || before === after) return

    await workspace.writeNoteText(path, before, after)
  }

  const view = createEditor({
    parent: host,
    doc: note.text,
    selection: { anchor: caretFor(note) },
    onChange: (doc) => {
      said = doc.toString()
      typed = true
      clearTimeout(settling)
      settling = setTimeout(() => void write(), SETTLES_AFTER)
    },
    notes: links.index(path),
    writeLink: pickedLink,
    shortcuts: shortcuts.forEditor,
    trustedMarkup: trustsHtmlAt(path),
    openLink: followHref,
    resolveImage: (src: string) => notePicture(src, path, said),
  })

  const settings = modes.settings
  view.dispatch({
    effects: modeEffects(locked ? { ...settings, readOnly: true, source: false } : settings),
  })
  scrollTo(view, note.at)

  return () => {
    clearTimeout(settling)
    void write()
    view.destroy()
  }
}

export function caretFor(note: Omit<PreviewNote, 'readOnly'>): number {
  const at = Math.min(Math.max(0, note.at), note.text.length)
  const matter = frontMatterBlock(note.text)

  return matter && at < matter.to ? Math.min(matter.to, note.text.length) : at
}

function scrollTo(view: EditorView, at: number) {
  if (at <= 0) return
  view.dispatch({ effects: EditorView.scrollIntoView(at, { y: 'start' }) })
}
