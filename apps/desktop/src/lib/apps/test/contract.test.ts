import { describe, expect, test } from 'vitest'
import { middle } from '../src/stats'
import { refreshRate } from '../src/view'
import { hostChoices, mayHost, programOf } from '../src/words'

describe('what an application is', () => {
  test('a program line is read the way a shell splits it', () => {
    expect(programOf('code --wait "My Notes/a b.md"')).toEqual({
      path: 'code',
      args: ['--wait', 'My Notes/a b.md'],
    })
    expect(programOf("say 'it\\s'")).toEqual({ path: 'say', args: ['it\\s'] })
    expect(programOf('open "unclosed')).toBeNull()
    expect(programOf('   ')).toBeNull()
  })
  test('only the three desktops host applications, and this computer is named as here', () => {
    expect(['linux', 'windows', 'macos'].every(mayHost)).toBe(true)
    expect(mayHost('ios')).toBe(false)
    const computers = [
      { id: 'a', name: 'Desk', platform: 'linux', current: true },
      { id: 'b', name: 'Laptop', platform: 'macos', current: false },
    ]
    expect(hostChoices(computers, (name) => `${name} (here)`)).toEqual([
      { id: 'a', label: 'Desk (here)', primary: true },
      { id: 'b', label: 'Laptop', primary: false },
    ])
  })
})
describe('the picture', () => {
  test('a screen refresh rate is read from the middle of the frame gaps once there are enough', () => {
    expect(refreshRate([16, 17, 16, 17, 16, 17, 16])).toBeNull()
    expect(refreshRate([16, 17, 16, 17, 16, 17, 16, 17, 40])).toBe(59)
    expect(refreshRate(Array.from({ length: 8 }, () => 1))).toBeNull()
    expect(middle([30, 10, 20])).toBe(20)
    expect(middle([])).toBeNull()
  })
})
