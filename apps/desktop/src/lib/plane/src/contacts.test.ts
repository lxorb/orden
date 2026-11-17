import { describe, expect, test } from 'vitest'
import {
  Contacts,
  hovering,
  leanOf,
  penKind,
  penProfile,
  penShape,
  Stylus,
  type Said,
} from './contacts'

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

  test('is the pen when a mouse presses button two on glass that has had a pen on it', () => {
    expect(penKind({ pointerType: 'mouse', button: 2, buttons: 2 }, tablet)).toEqual({
      kind: 'pen',
      eraser: true,
    })
  })

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

describe('the pens out there', () => {
  const desktop = { penSeen: true, touch: false }
  const tablet = { penSeen: true, touch: true }

  test('an Apple Pencil draws: pen, pressure, and no button of any kind', () => {
    expect(penKind({ pointerType: 'pen', button: 0, buttons: 1 }, tablet)).toEqual({
      kind: 'pen',
      eraser: false,
    })
  })

  test('a Surface Pen turned over rubs out, which is the eraser bit', () => {
    expect(penKind({ pointerType: 'pen', button: -1, buttons: 32 }, desktop)).toEqual({
      kind: 'pen',
      eraser: true,
    })
  })

  test('a Surface Pen holding its barrel rubs out, which is the right button', () => {
    expect(penKind({ pointerType: 'pen', button: 2, buttons: 3 }, desktop)).toEqual({
      kind: 'pen',
      eraser: true,
    })
  })

  test('a graphics tablet holding a button mapped to the middle one does not rub out', () => {
    expect(penKind({ pointerType: 'pen', button: 1, buttons: 5 }, desktop)).toEqual({
      kind: 'pen',
      eraser: false,
    })
  })

  test('a pen with no button and no pressure is still a pen', () => {
    expect(penKind({ pointerType: 'pen', button: 0, buttons: 1 }, desktop)).toEqual({
      kind: 'pen',
      eraser: false,
    })
  })
})

describe('a pointer over the glass', () => {
  test('is hovering when nothing at all is pressed', () => {
    expect(hovering({ buttons: 0 })).toBe(true)
  })

  test('is not hovering with the nib down', () => {
    expect(hovering({ buttons: 1 })).toBe(false)
  })

  test('is not hovering with a button held, whatever the nib is doing', () => {
    expect(hovering({ buttons: 2 })).toBe(false)
    expect(hovering({ buttons: 32 })).toBe(false)
  })

  test('is a contact the surface is holding, or it is not one at all', () => {
    const held = new Contacts()
    expect(held.has(4)).toBe(false)

    held.came(4, { pen: true, eraser: false })
    expect(held.has(4)).toBe(true)

    held.went(4)
    expect(held.has(4)).toBe(false)
  })
})

describe('the same nib arriving twice', () => {
  test('is an echo while a pen is on the glass', () => {
    const held = new Contacts()
    held.came(1, { pen: true, eraser: false })

    expect(held.echo({ pointerType: 'mouse', button: 0, buttons: 1 })).toBe(true)
  })

  test('is a mouse when no pen is on the glass', () => {
    const held = new Contacts()
    held.came(1, { pen: false, eraser: false })

    expect(held.echo({ pointerType: 'mouse', button: 0, buttons: 1 })).toBe(false)
  })

  test('is never a second pen, or a second finger', () => {
    const held = new Contacts()
    held.came(1, { pen: true, eraser: false })

    expect(held.echo({ pointerType: 'pen', button: 0, buttons: 1 })).toBe(false)
    expect(held.echo({ pointerType: 'touch', button: 0, buttons: 1 })).toBe(false)
  })

  test('is nothing once the pen has left', () => {
    const held = new Contacts()
    held.came(1, { pen: true, eraser: false })
    held.went(1)

    expect(held.echo({ pointerType: 'mouse', button: 0, buttons: 1 })).toBe(false)
  })
})

describe('which pen a machine has', () => {
  function said(agent: string, over: Partial<Said> = {}): Said {
    return { agent, touch: false, coalesced: true, predicted: true, ...over }
  }

  test('is an iPad, which says iPad', () => {
    expect(
      penShape(
        said(
          'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/604.1',
          { touch: true },
        ),
      ),
    ).toBe('apple')
  })

  test('is an iPad when it calls itself a Macintosh with a touch screen', () => {
    const agent =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15'

    expect(penShape(said(agent, { touch: true }))).toBe('apple')
    expect(penShape(said(agent))).toBe('desktop')
  })

  test('is Windows, where every pen reports the way Windows reports pens', () => {
    expect(
      penShape(
        said(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
          { touch: true },
        ),
      ),
    ).toBe('windows')
  })

  test('is a Chromebook, which says CrOS', () => {
    expect(
      penShape(
        said(
          'Mozilla/5.0 (X11; CrOS aarch64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
          { touch: true },
        ),
      ),
    ).toBe('chromeos')
  })

  test('is Android, whichever tablet it is', () => {
    expect(
      penShape(
        said(
          'Mozilla/5.0 (Linux; Android 15; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
          { touch: true },
        ),
      ),
    ).toBe('android')
  })

  test('is a desktop for a machine nobody recognises with no glass', () => {
    expect(penShape(said('Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0'))).toBe('desktop')
  })

  test('carries the Pencil its own gain and everything else none', () => {
    expect(penProfile(said('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)')).gain).toBe(0.8)
    expect(penProfile(said('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).gain).toBe(1)
  })

  test('carries what the browser can do, feature-detected rather than guessed', () => {
    const safari = penProfile(
      said('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)', {
        touch: true,
        coalesced: false,
        predicted: false,
      }),
    )

    expect(safari).toMatchObject({ shape: 'apple', coalesced: false, predicted: false })
  })

  test('says nothing about how a pen leans or presses until one has', () => {
    expect(penProfile(said('Mozilla/5.0 (Windows NT 10.0)'))).toMatchObject({
      lean: 'none',
      force: 'reported',
    })
  })
})

describe('how a pen says it leans', () => {
  test('is tilt when the two degrees off the vertical are there', () => {
    expect(leanOf({ pressure: 0.5, tiltX: -20, tiltY: 4 })).toBe('tilt')
  })

  test('is spherical when the altitude is, which is what Safari reports', () => {
    expect(
      leanOf({ pressure: 0.5, tiltX: 0, tiltY: 0, altitudeAngle: 0.7, azimuthAngle: 1.2 }),
    ).toBe('spherical')
  })

  test('is nothing for a pen standing straight up, in either language', () => {
    expect(leanOf({ pressure: 0.5, tiltX: 0, tiltY: 0 })).toBe('none')
    expect(
      leanOf({ pressure: 0.5, tiltX: 0, tiltY: 0, altitudeAngle: Math.PI / 2, azimuthAngle: 0 }),
    ).toBe('none')
  })
})

describe('the pen this glass has, learnt', () => {
  const machine: Said = {
    agent: 'Mozilla/5.0 (X11; CrOS aarch64 14541.0.0) Chrome/140.0.0.0',
    touch: true,
    coalesced: true,
    predicted: true,
  }

  function down(pressure: number, over: Partial<Record<'tiltX' | 'tiltY', number>> = {}) {
    return { pointerType: 'pen', button: -1, buttons: 1, pressure, tiltX: 0, tiltY: 0, ...over }
  }

  test('learns how it leans from the first pen event that leans', () => {
    const stylus = new Stylus(machine)
    expect(stylus.traits.lean).toBe('none')

    expect(stylus.saw(down(0.4, { tiltX: 12 }))).toBe(true)
    expect(stylus.traits.lean).toBe('tilt')
    expect(stylus.saw(down(0.5, { tiltX: 14 }))).toBe(false)
  })

  test('reads nothing at all off a finger or a mouse', () => {
    const stylus = new Stylus(machine)
    expect(stylus.saw({ ...down(1), pointerType: 'touch' })).toBe(false)
    expect(stylus.saw({ ...down(1), pointerType: 'mouse' })).toBe(false)
    expect(stylus.traits.force).toBe('reported')
  })

  test('stops believing a pressure that never changes', () => {
    const stylus = new Stylus(machine)
    let changed = false
    for (let one = 0; one < 40; one++) changed = stylus.saw(down(0.5)) || changed

    expect(changed).toBe(true)
    expect(stylus.traits.force).toBe('flat')
  })

  test('believes one that changes at all, and never asks again', () => {
    const stylus = new Stylus(machine)
    for (let one = 0; one < 40; one++) stylus.saw(down(0.3 + one * 0.01))

    expect(stylus.traits.force).toBe('reported')

    for (let one = 0; one < 40; one++) stylus.saw(down(0.5))
    expect(stylus.traits.force).toBe('reported')
  })

  test('takes it back the moment a flat pen turns out to have pressure', () => {
    const stylus = new Stylus(machine)
    for (let one = 0; one < 40; one++) stylus.saw(down(0.5))
    expect(stylus.traits.force).toBe('flat')

    expect(stylus.saw(down(0.62))).toBe(true)
    expect(stylus.traits.force).toBe('reported')
  })

  test('does not read a hovering pen as one with no pressure', () => {
    const stylus = new Stylus(machine)
    for (let one = 0; one < 40; one++) stylus.saw({ ...down(0), buttons: 0 })

    expect(stylus.traits.force).toBe('reported')
  })

  test('says what it believes in one line, for the hidden record', () => {
    const stylus = new Stylus({ ...machine, coalesced: false, predicted: false })
    stylus.saw(down(0.4, { tiltX: 3 }))

    expect(stylus.line).toBe('chromeos g1 tilt reported plain unguessed')
  })
})
