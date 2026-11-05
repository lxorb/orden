/** A base drawn inside a note: what the editor's ` ```base ` fence and `![[x.base]]`
 *  embed ask the app for (`mountBase` on the editor's note index), and what the reading
 *  view does over the placeholders the renderer left for the same two (docs/tasks.md
 *  5.11). Both put the same component in the same box, so a base reads the same on
 *  either face of a note.
 *
 *  Fetched the first time a note holds one, behind the door in link-index.svelte.ts
 *  and Reading.svelte: nothing of the views is in the first paint. */

import { mount, unmount } from 'svelte'
import { nameOf } from '../space-paths'
import BaseBlock from './BaseBlock.svelte'
import { embeddedPath } from './source'

/** What is drawn: a fence's words, or a base file a link names and one of its views. */
export type BaseAsk = { code: string } | { target: string; view: string | null }

export function mountBase(
  host: HTMLElement,
  ask: BaseAsk,
  from: string | null,
  stranger = false,
): () => void {
  const file = 'target' in ask ? embeddedPath(ask.target, from) : null
  if ('target' in ask && file === null) return () => undefined

  const title = file === null ? '' : nameOf(file).replace(/\.base$/i, '')
  const props =
    'code' in ask
      ? { code: ask.code, from, stranger, title }
      : { file, from, title, ...(ask.view ? { view: ask.view } : {}) }
  const made = mount(BaseBlock, { target: host, props })
  return () => void unmount(made)
}

/** Every base placeholder on a page the reading view rendered, drawn; answers what
 *  takes them all away. */
export function mountBases(
  surface: HTMLElement,
  from: string | null,
  stranger = false,
): () => void {
  const stops: (() => void)[] = []
  for (const host of surface.querySelectorAll<HTMLElement>('[data-base-code]')) {
    host.replaceChildren()
    stops.push(mountBase(host, { code: host.dataset.baseCode ?? '' }, from, stranger))
  }
  for (const card of surface.querySelectorAll<HTMLElement>(
    '.embed-file[data-kind="base"][data-file]',
  )) {
    const host = document.createElement('div')
    card.replaceWith(host)
    stops.push(
      mountBase(host, { target: card.dataset.file ?? '', view: card.dataset.view ?? null }, from),
    )
  }
  return () => {
    for (const stop of stops) stop()
  }
}
