// @vitest-environment jsdom
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, test } from 'vitest'
import { followAnchors, linkOpener } from './links'

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function cardWithLink(plain: boolean, href = 'https://x.test') {
  const links: string[] = []
  const view = new EditorView({
    state: EditorState.create({ extensions: [linkOpener.of((link) => void links.push(link))] }),
    parent: document.body,
  })
  open.push(view)
  const card = document.createElement('div')
  const anchor = document.createElement('a')
  anchor.setAttribute('href', href)
  anchor.textContent = 'source'
  card.append(anchor)
  document.body.append(card)
  followAnchors(card, () => view, plain)
  return { anchor, links }
}

function press(target: Element): MouseEvent {
  const keys = { bubbles: true, cancelable: true, button: 0 }
  target.dispatchEvent(new MouseEvent('mousedown', keys))
  const click = new MouseEvent('click', keys)
  target.dispatchEvent(click)
  return click
}

describe('links in a hover card', () => {
  test('open through the link opener on a plain click', () => {
    const { anchor, links } = cardWithLink(true)
    const click = press(anchor)
    expect(links).toEqual(['https://x.test'])
    expect(click.defaultPrevented).toBe(true)
  })

  test('are never followed by the browser, even when they do not open', () => {
    const { anchor, links } = cardWithLink(true, 'Plan.md')
    const click = press(anchor)
    expect(links).toEqual([])
    expect(click.defaultPrevented).toBe(true)
  })

  test('in an embed open only when asked, as in the note', () => {
    const { anchor, links } = cardWithLink(false)
    press(anchor)
    expect(links).toEqual([])
  })
})
