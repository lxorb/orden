import { expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'

vi.stubGlobal('localStorage', memoryStorage())
const { visited } = await import('./visited')
test('a space that keeps its web data apart keeps its history apart', () => {
  visited.saw('orden:web-visits', 'a', 'https://ethz.ch/', 'ETH')
  visited.saw('orden:web-visits:0-work', 'b', 'https://moodle-app2.let.ethz.ch/', 'Moodle')
  expect(visited.suggest('orden:web-visits', 'moodle')).toEqual([])
  expect(visited.suggest('orden:web-visits:0-work', 'moodle').map((one) => one.url)).toEqual([
    'https://moodle-app2.let.ethz.ch/',
  ])
  expect(localStorage.getItem('orden:web-visits:0-work')).toContain('moodle-app2')
  expect(localStorage.getItem('orden:web-visits')).not.toContain('moodle-app2')
})
test("says what a page called itself, whatever the address's fragment", () => {
  visited.saw('orden:web-visits:titles', 'c', 'https://svelte.dev/docs', 'Svelte docs')
  expect(visited.titleOf('orden:web-visits:titles', 'https://svelte.dev/docs#intro')).toBe('Svelte docs')
  expect(visited.titleOf('orden:web-visits:titles', 'https://svelte.dev/blog')).toBe('')
})
