import { settingFieldsIn } from '@orden/contracts'
import {
  setWord,
  BASES_WORD,
  CHATS_WORD,
  chatsOn,
  EXPERIMENTAL_WORD,
  experimentalOn,
  EXPLORER_WORD,
  hiddenKinds,
  PASS_WORD,
  TIME_WORD,
} from '../../gates/src/api'
import { prompt } from '../../ui-kit/src/api'
import { isDesktop, isMobile } from '../../platform/src/api'
import type { Field, Group, Pane } from './fields'

async function turnExperimental(on: boolean): Promise<void> {
  if (!on) {
    setWord(EXPERIMENTAL_WORD, false)
    return
  }
  if (experimentalOn()) return
  const sure = await prompt.confirm({
    title: 'Turn on experimental features?',
    detail: 'You will 100% experience bugs. Only go on if you know what you are doing.',
    confirmLabel: 'Turn on',
    danger: true,
  })
  if (sure) setWord(EXPERIMENTAL_WORD, true)
}
interface Feature {
  key: string
  word: string
  label: string
  hint: string
  words: string[]
  more?: () => Field[]
}
function featureGroup(one: Feature): Group {
  return {
    title: one.label,
    fields: [
      {
        kind: 'switch',
        key: `experimental.${one.key}`,
        label: one.label,
        hint: one.hint,
        words: ['experimental', ...one.words],
        initial: false,
        locked: () => !experimentalOn(),
        get: () => hiddenKinds.hidden.includes(one.word),
        set: (on) => setWord(one.word, on),
      },
      ...(one.more?.() ?? []),
    ],
  }
}
function chatFields(): Field[] {
  if (!chatsOn()) return []
  return isMobile ? [] : settingFieldsIn('experimental', 'Chats')
}
function features(): Feature[] {
  const bases: Feature = {
    key: 'databases',
    word: BASES_WORD,
    label: 'Databases',
    hint: 'Adds databases, notes that show other notes as a table, board or calendar; turning them off keeps the files.',
    words: ['database', 'databases', 'base', 'bases', 'table', 'board', 'kanban', 'notion'],
  }
  return [
    {
      key: 'chats',
      word: CHATS_WORD,
      label: 'Chats',
      hint: 'Adds chats with people, mail, Telegram, Slack, WhatsApp and Signal; turning it off keeps your messages.',
      words: ['chat', 'chats', 'messages', 'mail', 'telegram', 'slack', 'whatsapp', 'signal'],
      more: chatFields,
    },
    ...(isDesktop
      ? [
          {
            key: 'explorer',
            word: EXPLORER_WORD,
            label: 'File explorer',
            hint: 'Adds a file explorer for the folders on this computer, and Show in folder opens it.',
            words: ['explorer', 'files', 'folders', 'finder', 'show in folder'],
          },
        ]
      : []),
    {
      key: 'passwordManager',
      word: PASS_WORD,
      label: 'Password manager',
      hint: 'Adds Pass, which keeps passwords and fills them in on websites; turning it off keeps your vaults.',
      words: ['pass', 'password', 'passwords', 'vault', 'autofill', 'login', 'keychain'],
    },
    {
      key: 'timeTracker',
      word: TIME_WORD,
      label: 'Time tracker',
      hint: 'Adds a timer and records the app, site and tab in front and how busy the computer is.',
      words: ['time', 'tracking', 'timer', 'hours', 'activity', 'screen time', 'toggl'],
    },
    bases,
  ]
}
export function experimentalPane(): Pane {
  return {
    id: 'experimental',
    label: 'Experimental',
    groups: [
      {
        title: 'Experimental',
        fields: [
          {
            kind: 'switch',
            key: 'experimental.enabled',
            label: 'Enable experimental features',
            hint: 'Lets you turn on the features below, which are still being built.',
            words: ['experimental', 'beta', 'preview', 'labs', 'unstable', 'early'],
            initial: false,
            get: () => experimentalOn(),
            set: (on) => void turnExperimental(on),
          },
        ],
      },
      ...features().map(featureGroup),
    ],
  }
}
