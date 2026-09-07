import { describe, expect, test } from 'vitest'
import { deckOf } from '@nib/markdown/slides'
import {
  axesOf,
  back,
  clamp,
  FIT_STEPS,
  fitStep,
  forward,
  moveBetween,
  shownFragments,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  stageScale,
  stepsOf,
  toEnd,
  toSlide,
  typedSlide,
} from './stage'

describe('fitting the stage to a screen', () => {
  test('a screen of exactly the stage size needs no scaling', () => {
    expect(stageScale(STAGE_WIDTH, STAGE_HEIGHT)).toBe(1)
  })

  test('a wider screen letterboxes on the height', () => {
    expect(stageScale(STAGE_WIDTH * 2, STAGE_HEIGHT)).toBe(1)
  })

  test('a taller screen letterboxes on the width', () => {
    expect(stageScale(STAGE_WIDTH, STAGE_HEIGHT * 3)).toBe(1)
  })

  test('a small screen scales the whole stage down', () => {
    expect(stageScale(640, 360)).toBe(0.5)
  })

  test('a box with no area asks for nothing', () => {
    expect(stageScale(0, 720)).toBe(0)
    expect(stageScale(1280, 0)).toBe(0)
  })
})

describe('sizing a slide so it never scrolls', () => {
  test('a slide that fits keeps its full size', () => {
    expect(fitStep(() => true)).toBe(1)
  })

  test('a slide that never fits lands on the smallest size', () => {
    expect(fitStep(() => false)).toBe(FIT_STEPS.at(-1))
  })

  test('the largest size that fits is the one chosen', () => {
    for (const wanted of FIT_STEPS) {
      expect(fitStep((step) => step <= wanted)).toBe(wanted)
    }
  })

  test('four measurements settle a ten-rung ladder', () => {
    let asked = 0
    fitStep((step) => {
      asked++
      return step <= 0.6
    })

    expect(asked).toBeLessThanOrEqual(4)
  })
})

describe('moving through a deck', () => {
  const steps = [0, 2, 0]

  test('a press moves to the next slide when there is nothing to reveal', () => {
    expect(forward(steps, { slide: 0, step: 0 })).toEqual({ slide: 1, step: 0 })
  })

  test('a press reveals the next waiting item before moving on', () => {
    expect(forward(steps, { slide: 1, step: 0 })).toEqual({ slide: 1, step: 1 })
    expect(forward(steps, { slide: 1, step: 1 })).toEqual({ slide: 1, step: 2 })
    expect(forward(steps, { slide: 1, step: 2 })).toEqual({ slide: 2, step: 0 })
  })

  test('the end of the deck stays at the end', () => {
    const end = { slide: 2, step: 0 }
    expect(forward(steps, end)).toEqual(end)
  })

  test('going back undoes the last press', () => {
    expect(back(steps, { slide: 1, step: 2 })).toEqual({ slide: 1, step: 1 })
  })

  test('going back onto a slide finds it fully revealed', () => {
    expect(back(steps, { slide: 2, step: 0 })).toEqual({ slide: 1, step: 2 })
  })

  test('the start of the deck stays at the start', () => {
    expect(back(steps, { slide: 0, step: 0 })).toEqual({ slide: 0, step: 0 })
  })

  test('forward and back are each other, one press at a time', () => {
    // Exactly as far as the deck goes: past the end both keys stand still, and
    // standing still is not something the other one can undo.
    let at = { slide: 0, step: 0 }
    const walked = [at]
    for (let press = 0; press < 4; press++) {
      at = forward(steps, at)
      walked.push(at)
    }
    expect(at).toEqual(toEnd(steps))

    for (const was of walked.slice(0, -1).reverse()) {
      at = back(steps, at)
      expect(at).toEqual(was)
    }
  })

  test('a slide asked for by number arrives with nothing revealed', () => {
    expect(toSlide(steps, 1)).toEqual({ slide: 1, step: 0 })
  })

  test('a number past the end lands on the last slide', () => {
    expect(toSlide(steps, 99)).toEqual({ slide: 2, step: 0 })
    expect(toSlide(steps, -4)).toEqual({ slide: 0, step: 0 })
  })

  test('the end is the last slide with everything on it', () => {
    expect(toEnd([0, 2, 3])).toEqual({ slide: 2, step: 3 })
    expect(toEnd([])).toEqual({ slide: 0, step: 0 })
  })

  test('a place survives the slide under it being deleted', () => {
    expect(clamp([0, 0], { slide: 5, step: 3 })).toEqual({ slide: 1, step: 0 })
    expect(clamp([], { slide: 5, step: 3 })).toEqual({ slide: 0, step: 0 })
    expect(clamp([0, 1], { slide: 1, step: 4 })).toEqual({ slide: 1, step: 1 })
  })
})

describe('which way the deck moved', () => {
  const axes = axesOf(deckOf('# One\n\n***\n\n# Detail\n\n---\n\n# Two'))

  test('a step on the slide already up moves nothing', () => {
    expect(moveBetween(axes, 1, 1)).toBe(null)
  })

  test('a slide that continues the one before it is entered from above', () => {
    expect(moveBetween(axes, 0, 1)).toBe('down')
    expect(moveBetween(axes, 1, 0)).toBe('up')
  })

  test('any other slide arrives from the side', () => {
    expect(moveBetween(axes, 1, 2)).toBe('forward')
    expect(moveBetween(axes, 2, 1)).toBe('back')
  })
})

describe('jumping by typing a number', () => {
  test('a number names the slide the counter shows', () => {
    expect(typedSlide('1', 4)).toBe(0)
    expect(typedSlide('4', 4)).toBe(3)
  })

  test('a number the deck has not got names nothing', () => {
    expect(typedSlide('5', 4)).toBe(null)
    expect(typedSlide('0', 4)).toBe(null)
  })

  test('anything that is not a number names nothing', () => {
    expect(typedSlide('', 4)).toBe(null)
    expect(typedSlide('1a', 4)).toBe(null)
    expect(typedSlide('99999', 4)).toBe(null)
  })
})

describe('the deck a note makes', () => {
  const slides = deckOf('# One\n\n+ a\n+ b\n\n---\n\n# Two')

  test('each slide holds as many steps as it has waiting items', () => {
    expect(stepsOf(slides)).toEqual([2, 0])
  })

  test('the items come out one press at a time', () => {
    const fragments = slides[0]?.fragments ?? []
    expect(shownFragments(fragments, 0)).toEqual([])
    expect(shownFragments(fragments, 1)).toEqual([0])
    expect(shownFragments(fragments, 2)).toEqual([0, 1])
  })
})
