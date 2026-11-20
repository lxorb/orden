import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { settingsFollower } from '../src/lib/app-support'

function fakeHub() {
  const heard = new Map<string, Set<() => void>>()
  const add = (type: string, run: () => void) => {
    const all = heard.get(type) ?? new Set()
    heard.set(type, all)
    all.add(run)
    return () => void all.delete(run)
  }
  return {
    on: (type: 'settings', run: () => void) => add(type, run),
    opened: (run: () => void) => add('opened', run),
    say: (type: string) => {
      for (const run of heard.get(type) ?? []) run()
    },
  }
}
function world(token: string | null = 'token') {
  const said = { token, settings: { archived: ['a'] } }
  const asked: string[] = []
  const got: { archived: string[] }[] = []
  let open = 0
  let most = 0
  const follow = settingsFollower(
    () => said.token,
    async (one) => {
      asked.push(one)
      most = Math.max(most, ++open)
      await new Promise((done) => setTimeout(done, 5))
      open--
      return { ...said.settings }
    },
    (remote) => void got.push(remote),
  )
  return { said, asked, got, follow, most: () => most }
}
const settle = () => new Promise((done) => setTimeout(done, 40))
describe('the settings another device changed', () => {
  test('reach this device when the hub says settings changed, and when it opens again', async () => {
    const { said, got, follow } = world()
    const hub = fakeHub()
    const off = follow.hear(hub)
    said.settings = { archived: ['a', 'b'] }
    hub.say('settings')
    await settle()
    expect(got).toEqual([{ archived: ['a', 'b'] }])
    said.settings = { archived: [] }
    hub.say('opened')
    await settle()
    expect(got.at(-1)).toEqual({ archived: [] })
    off()
    hub.say('settings')
    await settle()
    expect(got).toHaveLength(2)
  })
  test('that come in a burst are read once more after the reading on its way, never two at a time', async () => {
    const { said, asked, got, follow, most } = world()
    const hub = fakeHub()
    follow.hear(hub)
    hub.say('settings')
    said.settings = { archived: ['late'] }
    hub.say('settings')
    hub.say('settings')
    await settle()
    expect(asked).toHaveLength(2)
    expect(most()).toBe(1)
    expect(got.at(-1)).toEqual({ archived: ['late'] })
  })
  test('ask for nothing while nobody is signed in', async () => {
    const { asked, follow } = world(null)
    const hub = fakeHub()
    follow.hear(hub)
    hub.say('settings')
    follow.take()
    await settle()
    expect(asked).toEqual([])
  })
  test('are followed by the app, from the hub as well as on signing in, with the follower loaded after the first paint', () => {
    const app = readFileSync(join(import.meta.dirname, '../src/App.svelte'), 'utf8')
    expect(app).toMatch(/whenLoaded\(support, \(one\) => \(stop = one\.hearAccountSettings\(\)\)\)/)
    expect(app).toMatch(/whenLoaded\(support, \(one\) => one\.accountSettings\.take\(\)\)/)
    expect(app).not.toMatch(/from '\.\/lib\/app-support'/)
    expect(app).not.toMatch(/modes\.adopt\(token\)/)
  })
})
