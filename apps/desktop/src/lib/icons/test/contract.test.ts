import { providePort, type SiteIcon } from '@orden/contracts'
import { describe, expect, test } from 'vitest'
import { ICON_SETS, keptPicture, keptSitePicture, LATER_SETS, PICKER_SETS, refreshSites, setNamed } from '../src/api'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
function sites(list: SiteIcon[]) {
  const held = {
    lacking: false,
    list,
    refreshed: 0,
    picture: (site: string) => list.find((one) => one.site === site)?.picture ?? null,
    refresh: () => {
      held.refreshed += 1
      return Promise.resolve()
    },
  }
  return held
}
describe('the sets', () => {
  test('each have their own id, and the picker offers only listed ones', () => {
    const ids = ICON_SETS.map((one) => one.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of [...PICKER_SETS, ...LATER_SETS]) expect(ids).toContain(id)
    for (const id of ids) expect(setNamed(id)?.id).toBe(id)
    expect(setNamed('no-such-set')).toBeNull()
  })
})
describe('the web icons', () => {
  const web = () => ICON_SETS.find((one) => one.label === 'Web icons')
  test('come from the site icons port, named by their label or their site', async () => {
    const held = sites([
      { site: 'a.dev', label: 'Alpha', picture: PNG },
      { site: 'b.dev', label: '', picture: PNG },
      { site: 'c.dev', label: 'Bare', picture: null },
    ])
    const stop = providePort('web.siteIcons', { held: () => Promise.resolve(held) })
    const set = await web()?.load()
    expect(set?.entries.map((one) => [one.name, one.words])).toEqual([
      ['a.dev', 'alpha'],
      ['b.dev', 'b.dev'],
    ])
    expect(set?.shape('a.dev')).toEqual({ kind: 'picture', src: PNG })
    expect(set?.shape('c.dev')).toBeNull()
    expect(set?.unoffered).toBe(false)
    held.lacking = true
    expect(set?.unoffered).toBe(true)
    expect(held.refreshed).toBe(1)
    refreshSites()
    await Promise.resolve()
    await Promise.resolve()
    expect(held.refreshed).toBe(2)
    stop()
  })
  test('are absent while no module provides the port', async () => {
    await expect(web()?.load()).rejects.toThrow()
    expect(() => refreshSites()).not.toThrow()
  })
})
describe('a kept picture', () => {
  const png = (length: number) => `data:image/png;base64,${'A'.repeat(length - 'data:image/png;base64,'.length)}`
  test('is drawn smaller until it fits the longest value an icon may be', async () => {
    const asked: number[] = []
    const sized: Record<number, number> = { 32: 4000, 24: 2049, 16: 1400 }
    const kept = await keptPicture('data:image/x-icon;base64,AAAA', (_src, size) => {
      asked.push(size)
      return Promise.resolve(png(sized[size] ?? 0))
    })
    expect(asked).toEqual([32, 24, 16])
    expect(kept).toBe(png(1400))
    expect(kept?.length).toBeLessThanOrEqual(2048)
  })
  test('stops at the first size that fits', async () => {
    const asked: number[] = []
    const kept = await keptPicture(PNG, (_src, size) => {
      asked.push(size)
      return Promise.resolve(png(900))
    })
    expect(asked).toEqual([32])
    expect(kept).toBe(png(900))
  })
  test('is nothing when no size fits or the picture cannot be drawn', async () => {
    expect(await keptPicture(PNG, () => Promise.resolve(png(5000)))).toBeNull()
    expect(await keptPicture(PNG, () => Promise.resolve(null))).toBeNull()
    expect(await keptPicture(PNG, () => Promise.reject(new Error('broken')))).toBeNull()
    expect(await keptPicture(PNG, () => Promise.resolve('data:image/jpeg;base64,AAAA'))).toBeNull()
    expect(await keptPicture(PNG)).toBeNull()
  })
})
describe('a web icon kept as a picture', () => {
  const small = 'data:image/png;base64,QUJD'
  test('is drawn from the picture the site list holds for that site, asking again when it holds none', async () => {
    const held = sites([{ site: 'a.dev', label: '', picture: 'data:image/x-icon;base64,AAAA' }])
    const stop = providePort('web.siteIcons', { held: () => Promise.resolve(held) })
    const drawn: string[] = []
    const paint = (src: string) => {
      drawn.push(src)
      return Promise.resolve(small)
    }
    expect(await keptSitePicture('a.dev', paint)).toBe(small)
    expect(drawn).toEqual(['data:image/x-icon;base64,AAAA'])
    expect(held.refreshed).toBe(0)
    expect(await keptSitePicture('b.dev', paint)).toBeNull()
    expect(held.refreshed).toBe(1)
    stop()
  })
  test('is nothing while no module holds the site list', async () => {
    expect(await keptSitePicture('a.dev', () => Promise.resolve(small))).toBeNull()
  })
})
