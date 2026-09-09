import { describe, expect, test } from 'vitest'
import { Contacts, penKind } from './contacts'

/** The barrel button, in every shape the browser has been seen to report it.
 *
 *  All of these are one S Pen on one tablet. The button rubs out; the question is only
 *  which of these three the browser will say this time, and getting one of them wrong
 *  is what made the button "somehow detected, somehow not". */
describe('what kind of pointer an event really is', () => {
  const desktop = { penSeen: true, touch: false }
  const tablet = { penSeen: true, touch: true }

  test('is a pen with the eraser bit set, which is Chromium on a desktop', () => {
    expect(penKind({ pointerType: 'pen', button: -1, buttons: 32 }, desktop)).toEqual({
      kind: 'pen',
      eraser: true,
    })
  })

  test('is a pen with the right button bit set, which is Chrome on Android', () => {
    expect(penKind({ pointerType: 'pen', button: 2, buttons: 2 }, tablet)).toEqual({
      kind: 'pen',
      eraser: true,
    })
  })

  /** The report that had no answer at all: a stylus with its button held looks like a
   *  mouse to the layer underneath, so on glass that has had a pen on it, it is one. */
  test('is the pen when a mouse presses button two on glass that has had a pen on it', () => {
    expect(penKind({ pointerType: 'mouse', button: 2, buttons: 2 }, tablet)).toEqual({
      kind: 'pen',
      eraser: true,
    })
  })

  /** And never on a desktop, where a right click is a right click and taking the menu
   *  away because somebody once drew with a stylus would be worse than the bug. */
  test('is a mouse when a mouse presses button two on a desktop', () => {
    expect(penKind({ pointerType: 'mouse', button: 2, buttons: 2 }, desktop)).toEqual({
      kind: 'mouse',
      eraser: false,
    })
  })

  test('is a mouse on glass that has never had a pen on it', () => {
    expect(
      penKind({ pointerType: 'mouse', button: 2, buttons: 2 }, { penSeen: false, touch: true }),
    ).toEqual({ kind: 'mouse', eraser: false })
  })

  test('is a pen with nothing held when nothing is held', () => {
    expect(penKind({ pointerType: 'pen', button: 0, buttons: 1 }, tablet)).toEqual({
      kind: 'pen',
      eraser: false,
    })
  })

  test('is the eraser button the spec names, which some pens turn over to report', () => {
    expect(penKind({ pointerType: 'pen', button: 5, buttons: 0 }, desktop)).toEqual({
      kind: 'pen',
      eraser: true,
    })
  })

  test('is a finger, whatever else is on the glass', () => {
    expect(penKind({ pointerType: 'touch', button: 0, buttons: 1 }, tablet)).toEqual({
      kind: 'touch',
      eraser: false,
    })
  })
})

/** The two things Samsung's S Pen does that no other pointer does: it lands as a
 *  finger and turns into a pen, and it presses its button a moment after the nib
 *  is already down. Both have to be noticed once and then left alone. */
describe('a contact that changes its story', () => {
  test('says nothing about a pointer that landed as a pen and stayed one', () => {
    const held = new Contacts()
    held.came(1, { pen: true, eraser: false })

    expect(held.turned(1, { pen: true, eraser: false })).toBeNull()
  })

  test('says a finger has turned out to be a pen, once', () => {
    const held = new Contacts()
    held.came(1, { pen: false, eraser: false })

    expect(held.turned(1, { pen: true, eraser: false })).toEqual({ eraser: false, first: true })
    expect(held.turned(1, { pen: true, eraser: false })).toBeNull()
  })

  test('says a button has come down after the nib, once', () => {
    const held = new Contacts()
    held.came(1, { pen: true, eraser: false })

    expect(held.turned(1, { pen: true, eraser: true })).toEqual({ eraser: true, first: false })
    expect(held.turned(1, { pen: true, eraser: true })).toBeNull()
  })

  test('says nothing about a finger, however long it stays', () => {
    const held = new Contacts()
    held.came(1, { pen: false, eraser: false })

    expect(held.turned(1, { pen: false, eraser: false })).toBeNull()
  })

  test('says nothing about a pointer nobody is holding', () => {
    const held = new Contacts()
    expect(held.turned(9, { pen: true, eraser: true })).toBeNull()

    held.came(1, { pen: false, eraser: false })
    held.went(1)
    expect(held.turned(1, { pen: true, eraser: false })).toBeNull()
  })
})
