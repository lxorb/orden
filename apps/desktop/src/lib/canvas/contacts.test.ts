import { describe, expect, test } from 'vitest'
import { Contacts } from './contacts'

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
