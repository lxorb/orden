import { describe, expect, test } from 'vitest'

import { chromiumEngine, mozillaEngine, safariEngine } from './search-engines'

/** `search.json.mozlz4` as Zen 1.24 wrote it once DuckDuckGo was chosen and Kagi added. */
const ZEN = {
  version: 14,
  engines: [
    { id: 'google', _name: 'Google', _isConfigEngine: true, _metaData: { order: 1 } },
    { id: 'ddg', _name: 'DuckDuckGo', _isConfigEngine: true, _metaData: { order: 3 } },
    {
      id: '8eb65bff-d778-4dc3-8c84-73dae03689ee',
      _name: 'Kagi',
      _loadPath: '[user]',
      _metaData: { alias: 'k', order: 4 },
      _urls: [{ params: [], rels: [], template: 'https://kagi.com/search?q=%s' }],
    },
  ],
  metaData: {
    locale: 'en-US',
    appDefaultEngineId: 'google',
    useSavedOrder: true,
    defaultEngineId: 'ddg',
    defaultEngineIdHash: 'HFSavauRhIgANGCy8HXuGd+sA43nvoP+T68CL3agT+o=',
  },
}

describe("a browser's search engine", () => {
  test("is Firefox's and Zen's chosen one, by its name, or a custom one's address", () => {
    expect(mozillaEngine(ZEN)).toEqual({ id: 'duckduckgo', name: 'DuckDuckGo' })
    const kagi = { ...ZEN, metaData: { ...ZEN.metaData, defaultEngineId: ZEN.engines[2]?.id } }
    expect(mozillaEngine(kagi)).toEqual({ custom: 'https://kagi.com/search?q=%s', name: 'Kagi' })
  })

  test('is nothing where nobody chose one', () => {
    const untouched = { ...ZEN, metaData: { ...ZEN.metaData, defaultEngineId: '' } }
    expect(mozillaEngine(untouched)).toBeNull()
    expect(chromiumEngine({ browser: {} })).toBeNull()
    expect(safariEngine(null)).toBeNull()
  })

  test("is a Chromium's, its address's own words in Orden's", () => {
    const prefs = (url: string, short_name: string) => ({
      default_search_provider_data: { template_url_data: { short_name, keyword: 'x', url } },
    })
    expect(
      chromiumEngine(prefs('https://www.ecosia.org/search?q={searchTerms}', 'Ecosia')),
    ).toEqual({ id: 'ecosia', name: 'Ecosia' })
    expect(
      chromiumEngine(prefs('{google:baseURL}search?q={searchTerms}&{google:RLZ}', 'Google search')),
    ).toEqual({ id: 'google', name: 'Google' })
    expect(chromiumEngine(prefs('https://search.example.com/?s={searchTerms}', 'Mine'))).toEqual({
      custom: 'https://search.example.com/?s=%s',
      name: 'Mine',
    })
    expect(
      chromiumEngine(prefs('https://x.example.com/?q={searchTerms}&e={inputEncoding}', 'X')),
    ).toBeNull()
  })

  test("is Safari's, by the name it shows", () => {
    expect(safariEngine('DuckDuckGo')).toEqual({ id: 'duckduckgo', name: 'DuckDuckGo' })
    expect(safariEngine('Nowhere')).toBeNull()
  })
})
