import { afterEach, expect, test } from 'vitest'

import { printInFrame } from '../../src/lib/files-out/src/api'

interface Shown {
  frame: HTMLIFrameElement
  closed: () => void
  printed: number
}

function shown(): Shown {
  const frame = document.querySelector<HTMLIFrameElement>('iframe[aria-hidden="true"]')
  if (!frame) throw new Error('the print put no frame in the page')

  const held: Shown = {
    frame,
    closed: () => {
      throw new Error('the print never asked to be told the dialog had closed')
    },
    printed: 0,
  }

  Object.defineProperty(frame, 'contentWindow', {
    configurable: true,
    get: () => ({
      document: { fonts: { ready: Promise.resolve() } },
      addEventListener: (kind: string, run: () => void) => {
        if (kind === 'afterprint') held.closed = run
      },
      focus: () => frame.focus(),
      print: () => {
        held.printed += 1
      },
    }),
  })

  return held
}

async function loaded(held: Shown): Promise<void> {
  held.frame.dispatchEvent(new Event('load'))
  await Promise.resolve()
  await Promise.resolve()
}

function typing(): HTMLInputElement {
  const field = document.createElement('input')
  document.body.append(field)
  field.focus()

  return field
}

afterEach(() => {
  document.body.innerHTML = ''
})

test('the keyboard goes back to whoever had it when the dialog closes', async () => {
  const field = typing()
  expect(document.activeElement).toBe(field)

  const printing = printInFrame('<p>on paper</p>')
  const held = shown()
  await loaded(held)

  expect(held.printed).toBe(1)
  expect(document.activeElement).toBe(held.frame)

  held.closed()
  await printing

  expect(held.frame.isConnected).toBe(false)
  expect(document.activeElement).toBe(field)
})

test('a print does not take the keyboard off what the reader moved to', async () => {
  typing()

  const printing = printInFrame('<p>on paper</p>')
  const held = shown()
  await loaded(held)

  const other = document.createElement('button')
  document.body.append(other)
  other.focus()

  held.closed()
  await printing

  expect(document.activeElement).toBe(other)
})
