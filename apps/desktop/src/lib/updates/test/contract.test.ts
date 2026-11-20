import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { providePort } from '@orden/contracts'
import { describe, expect, test, vi } from 'vitest'
import { asChannel, ready, restartToUpdate } from '../src/api'
import { stageUpdate } from '../src/updater'

const world = vi.hoisted(() => ({ installs: 0, installFails: false, relaunched: 0 }))
vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: () => {
    world.relaunched++
    return Promise.resolve()
  },
}))
vi.mock('../../platform/src/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string) => {
    if (command === 'update_may_install') return Promise.resolve(true)
    if (command === 'check_update')
      return Promise.resolve({ rid: 7, currentVersion: '1.3.0', version: '1.4.0', rawJson: {} })
    return Promise.resolve(null)
  },
}))
vi.mock('@tauri-apps/plugin-updater', () => ({
  Update: class {
    version = '1.4.0'
    download = () => Promise.resolve()
    close = () => Promise.resolve()
    install = () => {
      world.installs++
      return world.installFails ? Promise.reject(new Error('refused')) : Promise.resolve()
    }
  },
}))

const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')
describe('the module stands on its own', () => {
  test('the api leaves the update by the system and the move to Applications behind doors', () => {
    const api = readFileSync(join(SRC, 'api.ts'), 'utf8')
    const statics = [...api.matchAll(/from '\.\/([A-Za-z.-]+)'/g)].map((found) => found[1])
    expect(statics).not.toContain('system-update')
    expect(statics).not.toContain('app-place')
  })
})
describe('an update', () => {
  test('comes from the stable channel unless the unstable one was asked for', () => {
    expect(asChannel('unstable')).toBe('unstable')
    expect(asChannel('nightly')).toBe('stable')
    expect(asChannel(undefined)).toBe('stable')
  })
  test('is not restarted into when quitting is refused', async () => {
    const asked: string[] = []
    const unbind = providePort('quit.ask', {
      mayStop: (why) => {
        asked.push(why)
        return Promise.resolve(false)
      },
    })
    await restartToUpdate()
    unbind()
    expect(asked).toEqual(['restart'])
    expect(ready()).toBe(false)
  })
})
describe('after an install that failed', () => {
  test('the next Restart now tries again with the update it downloaded', async () => {
    const unbind = providePort('quit.ask', { mayStop: () => Promise.resolve(true) })
    await stageUpdate('stable')
    world.installFails = true
    await restartToUpdate()
    expect(ready()).toBe(true)
    world.installFails = false
    await restartToUpdate()
    unbind()
    expect([world.installs, world.relaunched, ready()]).toEqual([2, 1, false])
  })
})
