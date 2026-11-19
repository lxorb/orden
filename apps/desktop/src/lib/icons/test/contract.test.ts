import { providePort, type SiteIcon } from '@orden/contracts'
import { describe, expect, test } from 'vitest'
import { ICON_SETS, LATER_SETS, PICKER_SETS, refreshSites, setNamed } from '../src/api'

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
