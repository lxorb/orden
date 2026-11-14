import type { SettingField } from '@orden/contracts'
import { asWarning, quitAsk } from '../../quitting/src/api'
import { BY_ID } from '../../shortcuts/registry'
import { shellName, shells, SIZES } from './shells.svelte'
import { bothName } from './two-ways'

function twoWayFields(): SettingField[] {
  return Object.keys(shells.ways)
    .filter((command) => BY_ID.has(command))
    .map((command): SettingField => ({
      kind: 'select',
      label: bothName(command),
      hint: 'Whether this key goes to Orden or to the program in the terminal, or asks each time.',
      words: ['shortcut', 'key', 'shell', 'conflict', 'ask'],
      options: [
        { value: 'ask', label: 'Always ask' },
        { value: 'app', label: BY_ID.get(command)?.label() ?? command },
        { value: 'shell', label: 'Terminal' },
      ],
      initial: 'ask',
      get: () => shells.ways[command] ?? 'ask',
      set: (value) => shells.setWay(command, value === 'app' || value === 'shell' ? value : null),
    }))
}

export function terminalFields(): SettingField[] {
  void shells.ask()

  return [
    {
      kind: 'select',
      key: 'general.shell',
      open: true,
      label: 'Shell',
      hint: 'The shell a new terminal starts.',
      options: shells.list.map((one) => ({ value: one.id, label: shellName(one) })),
      get: () => shells.chosen?.id ?? '',
      set: (id) => shells.choose(id),
    },
    {
      kind: 'slider',
      key: 'general.terminalTextSize',
      label: 'Text size',
      hint: 'How large the text in terminals is.',
      min: SIZES.least,
      max: SIZES.most,
      step: 1,
      unit: 'px',
      initial: SIZES.initial,
      get: () => shells.size,
      set: (size) => shells.setSize(size),
    },
    {
      kind: 'switch',
      key: 'general.terminalThemed',
      label: 'Colours follow the theme',
      hint: 'Paints terminals in the theme’s colours; off keeps one fixed palette.',
      words: ['colour', 'color', 'palette', 'ansi', 'theme', 'dark', 'light'],
      initial: true,
      get: () => shells.themed,
      set: (on) => shells.setThemed(on),
    },
    {
      kind: 'switch',
      key: 'general.restoreTerminalHistory',
      label: 'Restore history',
      hint: 'Brings back what each terminal showed after Orden restarts; off forgets it on quit.',
      words: ['scrollback', 'session', 'restart', 'privacy'],
      initial: true,
      get: () => shells.restoring,
      set: (on) => shells.setRestoring(on),
    },
    {
      kind: 'select',
      key: 'general.warnBeforeQuitting',
      label: 'Warn before quitting',
      hint: 'Asks before Orden quits with terminals open: always, or only while something runs in one.',
      words: ['quit', 'close', 'exit', 'confirm', 'running', 'process', 'claude'],
      options: [
        { value: 'always', label: 'Always' },
        { value: 'running', label: 'When something runs' },
        { value: 'never', label: 'Never' },
      ],
      initial: 'running',
      get: () => quitAsk.warning,
      set: (value) => quitAsk.warnWhen(asWarning(value)),
    },
    ...twoWayFields(),
  ]
}
