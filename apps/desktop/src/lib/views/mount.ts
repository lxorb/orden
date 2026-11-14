import { mount, unmount } from 'svelte'
import { nameOf } from '../platform/src/api'
import BaseBlock from './BaseBlock.svelte'
import { embeddedPath } from './source'

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
