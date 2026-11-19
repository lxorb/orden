import { beforeEach, describe, expect, test, vi } from 'vitest'
import { READER } from '../../automation/src/api'

const world = vi.hoisted(() => ({ style: 'default', loaded: true }))
vi.mock('../../agent-verbs/src/api', async (original) => ({
  ...(await original<typeof import('../../agent-verbs/src/api')>()),
  asked: () => Promise.resolve(null),
}))
vi.mock('../../settings/src/api', async (original) => ({
  ...(await original<typeof import('../../settings/src/api')>()),
  settingDeclarations: () =>
    Promise.resolve({
      declarations: () =>
        Promise.resolve([
          {
            kind: 'select',
            key: 'appearance.style',
            open: true,
            label: 'Style',
            hint: 'The theme Orden is drawn in.',
            options: world.loaded
              ? [
                  { value: 'default', label: 'Classic' },
                  { value: 'wallpaper', label: 'Wallpaper' },
                ]
              : [],
            get: () => world.style,
            set: (value: string) => (world.style = value),
          },
        ]),
    }),
}))
const { readSetting, writeSetting } = await import('./settings')
const call = (verb: string, args: Record<string, unknown>) => ({ verb, args, caller: READER })
beforeEach(() => {
  world.style = 'default'
  world.loaded = true
})
describe('a setting chosen from a list that can grow', () => {
  test('takes one of the choices it has now', async () => {
    const answer = await writeSetting(call('write_setting', { key: 'appearance.style', value: 'wallpaper' }))
    expect(answer).toMatchObject({ ok: true, result: { changed: true, value: 'wallpaper' } })
    expect(world.style).toBe('wallpaper')
  })
  test('refuses what is not among them, and names them when read', async () => {
    await expect(writeSetting(call('write_setting', { key: 'appearance.style', value: 'Wallpaper' }))).rejects.toThrow(
      /default, wallpaper|"default", "wallpaper"/,
    )
    expect(world.style).toBe('default')
    const read = await readSetting(call('read_setting', { key: 'appearance.style' }))
    expect(read).toMatchObject({ ok: true, result: { choices: ['default', 'wallpaper'] } })
  })
  test('is not refused for good while its choices are still being found', async () => {
    world.loaded = false
    await writeSetting(call('write_setting', { key: 'appearance.style', value: 'wallpaper' }))
    expect(world.style).toBe('wallpaper')
  })
})
