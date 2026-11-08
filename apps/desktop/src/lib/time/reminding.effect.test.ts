import { expect, test, vi } from 'vitest'

const shown = vi.hoisted(() => [] as string[])
const running = vi.hoisted(() => ({
  id: 'long',
  start: Date.now() - 5 * 3_600_000,
  end: null,
  activity: null,
  tags: [],
  note: '',
  source: 'timer',
  place: null,
  label: null,
  device: null,
}))

vi.mock('../notify', () => ({
  notify: (_title: string, _body: string, tag: string) => shown.push(tag),
}))
vi.mock('../settings.svelte', () => ({ timeOn: () => true }))
vi.mock('./time.svelte', () => ({
  time: {
    ready: true,
    reminding: true,
    goals: [],
    spans: [running],
    rules: [],
    activity: () => null,
  },
}))

const { remind } = await import('./reminding')

test('a reminder another window has already given is not given again', async () => {
  localStorage.setItem('orden:time-told', JSON.stringify(['timer:long']))
  await remind()
  expect(shown).toEqual([])
})

test('a reminder is given once, and the next window to look knows it was', async () => {
  localStorage.removeItem('orden:time-told')
  await remind()
  await remind()
  expect(shown).toEqual(['time-timer:long'])
  expect(JSON.parse(localStorage.getItem('orden:time-told') ?? '[]')).toEqual(['timer:long'])
})
