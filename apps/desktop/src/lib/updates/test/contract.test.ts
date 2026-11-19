import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { providePort } from '@orden/contracts'
import { describe, expect, test } from 'vitest'
import { asChannel, ready, restartToUpdate } from '../src/api'

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
