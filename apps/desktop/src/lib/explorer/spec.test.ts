import { describe, expect, it } from 'vitest'
import {
  readSpec,
  type Spec,
  specMoved,
  steppedBack,
  steppedForward,
  wentTo,
  writeSpec,
} from './spec'

describe("a file explorer's words", () => {
  it('come back as they were written, and nothing else reads as one', () => {
    const spec = { folder: '/home/me', back: ['/'], ahead: ['/home/me/Music'] }
    expect(readSpec(writeSpec(spec))).toEqual(spec)
    expect(readSpec('')).toBeNull()
    expect(readSpec('{"folder": 3}')).toBeNull()
    expect(readSpec('{"folder": "/a", "back": "x"}')).toEqual({ folder: '/a', back: [], ahead: [] })
  })

  it('walk back and forward the way a browser does', () => {
    let spec: Spec = { folder: '/a', back: [], ahead: [] }
    spec = wentTo(spec, '/a/b')
    spec = wentTo(spec, '/a/b/c')
    expect(spec.back).toEqual(['/a', '/a/b'])
    const back = steppedBack(spec)
    expect(back).toEqual({ folder: '/a/b', back: ['/a'], ahead: ['/a/b/c'] })
    expect(back && steppedForward(back)).toEqual(spec)
    expect(back && wentTo(back, '/x').ahead).toEqual([])
    expect(steppedBack({ folder: '/a', back: [], ahead: [] })).toBeNull()
    expect(steppedForward(spec)).toBeNull()
  })

  it('take no step for the folder already on screen', () => {
    const spec = { folder: '/a', back: ['/'], ahead: [] }
    expect(wentTo(spec, '/a')).toBe(spec)
  })
})

describe('a move', () => {
  it('carries the folder and the way back and ahead along, and leaves the rest', () => {
    const spec: Spec = { folder: '/a/b/c', back: ['/a', '/a/b'], ahead: ['/ab', '/a/b/c/d'] }
    expect(specMoved(spec, '/a/b', '/x')).toEqual({
      folder: '/x/c',
      back: ['/a', '/x'],
      ahead: ['/ab', '/x/c/d'],
    })
    expect(specMoved(spec, '/q', '/r')).toBeNull()
  })
})
