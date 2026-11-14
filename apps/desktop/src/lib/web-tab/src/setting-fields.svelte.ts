import type { SettingField } from '@orden/contracts'
import { enginesFor, isEngineAddress } from '@orden/scan/engines'
import { isDesktop } from '../../platform/src/api'
import { pages } from './pages.svelte'
import { isSaver } from './resting'
import { saver } from './saver.svelte'
import { CUSTOM, searchEngine } from './search-engine.svelte'

let asking = $state(false)

export const browserFields = (): SettingField[] => [
  {
    kind: 'select',
    key: 'general.searchEngine',
    open: true,
    label: 'Search engine',
    hint: 'Where words typed into a web tab’s address bar are searched.',
    options: [
      ...enginesFor(navigator.language).map((one) => ({ value: one.id, label: one.name })),
      { value: CUSTOM, label: 'Custom' },
    ],
    get: () => (asking ? CUSTOM : searchEngine.id),
    set: (id) => {
      asking = id === CUSTOM && !searchEngine.custom
      searchEngine.choose(id)
    },
  },
  {
    kind: 'text',
    key: 'general.searchEngineAddress',
    label: 'Search address',
    hint: 'The search address, with %s where the words go.',
    placeholder: 'https://example.com/search?q=%s',
    check: (address) => (isEngineAddress(address) ? null : 'is not an address with %s in it'),
    shown: () => asking || searchEngine.id === CUSTOM,
    get: () => searchEngine.custom,
    set: (address) => {
      if (searchEngine.setCustom(address)) asking = false
    },
  },
]

export const tabFields = (): SettingField[] =>
  isDesktop
    ? [
        {
          kind: 'select',
          key: 'general.memorySaver',
          label: 'Memory saver',
          hint: 'Unloads web pages that have been out of sight for a while to free memory; they load again when you return.',
          words: ['memory', 'ram', 'discard', 'sleep', 'reload', 'performance'],
          options: [
            { value: 'off', label: 'Off' },
            { value: 'moderate', label: 'Moderate' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'maximum', label: 'Maximum' },
          ],
          initial: 'off',
          get: () => saver.mode,
          set: (value) => {
            saver.set(isSaver(value) ? value : 'off')
            pages.retime()
          },
        },
      ]
    : []
