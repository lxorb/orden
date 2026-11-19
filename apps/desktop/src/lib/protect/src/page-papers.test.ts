import { beforeEach, describe, expect, test } from 'vitest'
import '../test/storage'

const { Protection } = await import('./protection.svelte')
const ROOT = '/space'
beforeEach(() => localStorage.clear())
describe('the paper of a page note', () => {
  test('stays locked after its page note is renamed', () => {
    const protection = new Protection()
    protection.set(ROOT, `${ROOT}/paper.pdf`, 'password')
    protection.moved(`${ROOT}/paper.pdf`, `${ROOT}/paper.pages.pdf`, ROOT)
    protection.copied(`${ROOT}/paper.pages.pdf`, `${ROOT}/paper.pages`, ROOT, ROOT)
    expect(protection.agentsMay(`${ROOT}/paper.pages.pdf`)).toBe(false)
    protection.moved(`${ROOT}/paper.pages`, `${ROOT}/Renamed.pages`, ROOT)
    expect(protection.agentsMay(`${ROOT}/Renamed.pages.pdf`)).toBe(false)
    expect(protection.ways(ROOT)).toEqual({
      'Renamed.pages': 'password',
      'Renamed.pages.pdf': 'password',
      'paper.pages.pdf': 'password',
    })
  })
  test('is locked with its page note', () => {
    const protection = new Protection()
    protection.set(ROOT, `${ROOT}/Lecture.pages`, 'password')
    expect(protection.agentsMay(`${ROOT}/Lecture.pages.pdf`)).toBe(false)
    expect(protection.locked(`${ROOT}/Lecture.pages.pdf`)).toBe(true)
  })
  test('keeps the lock of a folder its page note left', () => {
    const protection = new Protection()
    protection.set(ROOT, `${ROOT}/Private`, 'password')
    protection.moved(`${ROOT}/Private/Scan.pages`, `${ROOT}/Open/Scan.pages`, ROOT)
    expect(protection.agentsMay(`${ROOT}/Open/Scan.pages.pdf`)).toBe(false)
  })
  test('of a copied locked page note is locked too', () => {
    const protection = new Protection()
    protection.set(ROOT, `${ROOT}/Lecture.pages`, 'password')
    protection.set(ROOT, `${ROOT}/Lecture.pages.pdf`, 'password')
    protection.copied(`${ROOT}/Lecture.pages`, `${ROOT}/Copy.pages`, ROOT, ROOT)
    expect(protection.ways(ROOT)['Copy.pages.pdf']).toBe('password')
  })
  test('left behind by a page note renamed outside Orden stays locked', () => {
    const protection = new Protection()
    protection.set(ROOT, `${ROOT}/Lecture.pages`, 'password')
    protection.set(ROOT, `${ROOT}/Lecture.pages.pdf`, 'password')
    protection.moved(`${ROOT}/Lecture.pages`, `${ROOT}/Talk.pages`, ROOT)
    expect(protection.agentsMay(`${ROOT}/Lecture.pages.pdf`)).toBe(false)
    expect(protection.agentsMay(`${ROOT}/Talk.pages.pdf`)).toBe(false)
  })
})
