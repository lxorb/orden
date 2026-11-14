import '../../sync-ports'
import 'fake-indexeddb/auto'
import { describe, expect, test } from 'vitest'
import { carryDatabase } from '../../web-backend/src/web/carry-database'
import { deviceWeb, forgetWeb, openWeb } from './browser-store'
import { leadSync } from './lead'
import { get, put } from './store'

async function names(): Promise<string[]> {
  return (await indexedDB.databases()).flatMap((one) => (one.name ? [one.name] : []))
}

describe('what an older version kept in this browser under nib', () => {
  test('keeps a sync store, its device and its rows', async () => {
    const first = await openWeb('former')
    const device = first.opened.device
    await first.write([put('files', { hash: 'h', state: 'here' })])
    await first.close()
    await carryDatabase('orden-sync:former', 'nib-sync:former')
    expect(await names()).toContain('nib-sync:former')

    expect(await deviceWeb('former')).toBe(device)
    const again = await openWeb('former')
    expect(again.opened.device).toBe(device)
    expect((await again.read([get('files', 'h')]))[0]).toMatchObject({
      hash: 'h',
    })
    await again.close()
    expect(await names()).not.toContain('nib-sync:former')

    await carryDatabase('orden-sync:former', 'nib-sync:former')
    await forgetWeb('former')
    expect(await names()).not.toContain('nib-sync:former')
    expect(await names()).not.toContain('orden-sync:former')
  })

  test('leaves no tab of an older version leading beside a new one', async () => {
    const locks = (globalThis.navigator as Navigator | undefined)?.locks
    expect(locks, 'Web Locks need Node 24').toBeDefined()
    const leading = await leadSync(undefined, 'acct')
    const older = await locks?.request('nib-sync:acct', { ifAvailable: true }, (lock) => lock)
    expect(older).toBeNull()
    leading?.release()
  })
})
