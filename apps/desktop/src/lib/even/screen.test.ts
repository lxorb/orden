import { beforeEach, describe, expect, test } from 'vitest'
import { BLANK, type Page, QUADRANTS, type Sheet } from '@nib/glasses'
import { type Drawer, Panel } from './screen'
import type { Container, Glasses, Input, Made, Sent } from './sdk'
import type { Showing } from './session'

const page = (hash: string): Page => ({
  index: 0,
  from: 0,
  to: 1,
  lines: [],
  tops: [],
  hash,
})

const showing: Showing = { key: 'a', name: 'A note', page: 0, count: 3 }

/** A page whose four containers are named by `marks`: a hash each, or `BLANK`
 *  for one with nothing on it. */
function sheet(...marks: string[]): Sheet {
  return {
    hash: marks.join('|'),
    quadrants: QUADRANTS.map((_one, at) => ({
      at,
      bytes: new Uint8Array([at]),
      blank: marks[at] === BLANK,
      hash: marks[at] ?? BLANK,
    })),
  }
}

class Fake implements Glasses {
  readonly images: { name: string; bytes: number[] }[] = []
  readonly written: string[] = []
  started = false
  left = false
  /** What each send answers, in order; anything past the end answers ok. */
  answers: Sent[] = []

  /** What the host answers when the page is asked for. */
  made: Made = 'made'

  start(): Promise<Made> {
    this.started = true
    return Promise.resolve(this.made)
  }

  image(container: Container, bytes: Uint8Array): Promise<Sent> {
    const answer = this.answers.shift() ?? 'ok'
    if (answer === 'ok') this.images.push({ name: container.name, bytes: [...bytes] })
    return Promise.resolve(answer)
  }

  words(_container: Container, content: string): Promise<boolean> {
    this.written.push(content)
    return Promise.resolve(true)
  }

  listen(_handler: (input: Input) => void): () => void {
    return () => undefined
  }

  leave(): Promise<void> {
    this.left = true
    return Promise.resolve()
  }
}

let glasses: Fake

/** A drawer that answers with whatever sheet it was last given. */
function drawing(...sheets: Sheet[]): Drawer {
  const queue = [...sheets]
  let last = sheets[0] ?? null
  return {
    sheet: () => {
      last = queue.shift() ?? last
      return Promise.resolve(last)
    },
  }
}

beforeEach(() => {
  glasses = new Fake()
})

describe('the page the glasses hold', () => {
  test('is made once, with five containers and one that captures', async () => {
    const panel = new Panel(glasses, drawing(sheet('a', 'b', 'c', 'd')))
    expect(await panel.open()).toBe('made')
    expect(glasses.started).toBe(true)

    // Made once: a second call is refused by the host, and refused slowly.
    glasses.started = false
    expect(await panel.open()).toBe('made')
    expect(glasses.started).toBe(false)
  })

  test('says in the host’s own word when the page was not made', async () => {
    // Which of the refusals it was, is the difference between a page worth asking
    // for differently and one the radio simply never heard. A boolean threw that
    // away, and a phone has no console to read it back from.
    glasses.made = 'outOfMemory'
    const panel = new Panel(glasses, drawing(sheet('a', 'b', 'c', 'd')))

    expect(await panel.open()).toBe('outOfMemory')
    // And keeps saying it, rather than asking again for a page it cannot have.
    expect(await panel.open()).toBe('outOfMemory')
    expect(glasses.started).toBe(true)
  })
})

describe('what a page turn sends', () => {
  test('every container the first time', async () => {
    const panel = new Panel(glasses, drawing(sheet('a', 'b', 'c', 'd')))
    await panel.show(page('one'), showing)

    expect(glasses.images.map((one) => one.name)).toEqual(['nib1', 'nib2', 'nib3', 'nib4'])
  })

  test('nothing at all for a container that has not moved', async () => {
    const panel = new Panel(glasses, drawing(sheet('a', 'b', 'c', 'd'), sheet('a', 'B', 'c', 'D')))
    await panel.show(page('one'), showing)
    glasses.images.length = 0
    await panel.show(page('two'), showing)

    expect(glasses.images.map((one) => one.name)).toEqual(['nib2', 'nib4'])
  })

  test('nothing for the dark half of a page of prose', async () => {
    // Two thirds of a page of prose is empty, and a container starts empty, so
    // the first page of a short note is two sends rather than four.
    const panel = new Panel(glasses, drawing(sheet('a', 'b', BLANK, BLANK)))
    await panel.show(page('one'), showing)

    expect(glasses.images.map((one) => one.name)).toEqual(['nib1', 'nib2'])
  })

  test('the darkness once, when a container has to be cleared', async () => {
    const panel = new Panel(
      glasses,
      drawing(
        sheet('a', 'b', 'c', 'd'),
        sheet('a', 'b', BLANK, BLANK),
        sheet('a', 'b', BLANK, BLANK),
      ),
    )
    await panel.show(page('one'), showing)
    glasses.images.length = 0
    await panel.show(page('two'), showing)
    expect(glasses.images.map((one) => one.name)).toEqual(['nib3', 'nib4'])

    glasses.images.length = 0
    await panel.show(page('three'), showing)
    expect(glasses.images).toEqual([])
  })

  test('in reading order, because the glasses reveal each as it lands', async () => {
    const panel = new Panel(glasses, drawing(sheet('a', 'b', 'c', 'd')))
    await panel.show(page('one'), showing)

    expect(glasses.images.map((one) => one.bytes[0])).toEqual([0, 1, 2, 3])
  })
})

describe('when a send fails', () => {
  test('tries once more, and leaves the container for the next turn', async () => {
    glasses.answers = ['again', 'ok']
    const panel = new Panel(glasses, drawing(sheet('a', 'b', 'c', 'd')))
    await panel.show(page('one'), showing)

    expect(glasses.images.map((one) => one.name)).toEqual(['nib1', 'nib2', 'nib3', 'nib4'])
  })

  test('does not remember a container it could not fill', async () => {
    glasses.answers = ['again', 'again']
    const panel = new Panel(glasses, drawing(sheet('a', 'b', 'c', 'd'), sheet('a', 'b', 'c', 'd')))
    await panel.show(page('one'), showing)
    glasses.images.length = 0

    // The same page again: the one that did not land is sent, the three that did
    // are not.
    await panel.show(page('one'), showing)
    expect(glasses.images.map((one) => one.name)).toEqual(['nib1'])
  })

  test('falls back to words once the image channel is dead', async () => {
    glasses.answers = ['dead']
    const words = page('one')
    words.lines = [
      {
        placed: [{ run: { text: 'Some words', style: BODY }, x: 0, width: 10 }],
        height: 20,
        baseline: 16,
        from: 0,
        fills: [],
        glue: false,
      },
    ]

    const panel = new Panel(glasses, drawing(sheet('a', 'b', 'c', 'd'), sheet('a', 'b', 'c', 'd')))
    await panel.show(words, showing)
    expect(glasses.written).toEqual(['Some words'])

    // And stays there: no more images are attempted.
    glasses.images.length = 0
    await panel.show(words, showing)
    expect(glasses.images).toEqual([])
    expect(glasses.written).toHaveLength(2)
  })

  test('writes words when there is no canvas to draw on', async () => {
    const panel = new Panel(glasses, { sheet: () => Promise.resolve(null) })
    await panel.show(page('one'), showing)

    // A page with no lines still says something rather than nothing: a space,
    // which is what the capture layer holds when it is empty.
    expect(glasses.written).toEqual([' '])
    expect(glasses.images).toEqual([])
  })
})

/** The style a run needs to exist; nothing here draws it. */
const BODY = {
  family: 'content' as const,
  size: 16,
  weight: 'normal' as const,
  slant: 'normal' as const,
  grey: 15,
  underline: false,
  strike: false,
}
