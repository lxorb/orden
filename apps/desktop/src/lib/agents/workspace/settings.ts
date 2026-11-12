import type { AgentAnswer } from '../../automation/caller'
import { ACCENTS } from '../../accents'
import { CATALOGUE_IDS, i18n } from '../../i18n.svelte'
import { LINK_FORMATS } from '../../link-format'
import { LINE_HEIGHTS, modes, WIDTHS } from '../../modes.svelte'
import { theme } from '../../theme.svelte'
import type { Field } from '../../settings/fields'
import { asked } from './asks'
import { type Call, done, need } from './call'
import { Refused } from './problem'

interface Setting {
  about: string
  read: (call: Call) => unknown
  write: (value: unknown, call: Call) => Change | Promise<Change>
  choices?: readonly string[]
}

type Change = () => unknown

function oneOf<T extends string>(value: unknown, choices: readonly T[], name: string): T {
  const found = choices.find((one) => one === value)
  if (found === undefined)
    throw new Refused('bad_arguments', `${name} is one of ${choices.join(', ')}`)

  return found
}

function isOn(value: unknown, name: string): boolean {
  if (typeof value === 'boolean') return value
  throw new Refused('bad_arguments', `${name} is true or false`)
}

function numberIn(value: unknown, choices: readonly number[], name: string): number {
  const said = Number(value)
  const found = choices.find((one) => Math.abs(one - said) < 1e-9)
  if (found === undefined)
    throw new Refused('bad_arguments', `${name} is one of ${choices.join(', ')}`)

  return found
}

function toggled(read: () => boolean, toggle: () => void, about: string): Setting {
  return {
    about,
    read,
    write: (value, call) => {
      const wanted = isOn(value, need(call, 'key'))
      return () => {
        if (read() !== wanted) toggle()
      }
    },
  }
}

const SETTINGS: Record<string, Setting> = {
  theme: {
    about: 'the theme, by id',
    get choices() {
      return theme.all.map((one) => one.id)
    },
    read: () => theme.id,
    write: (value) => {
      const id = oneOf(
        value,
        theme.all.map((one) => one.id),
        'theme',
      )
      return () => theme.select(id)
    },
  },
  scheme: {
    about: 'light, dark or system',
    read: () => theme.scheme,
    write: (value) => {
      const choice = oneOf(value, ['light', 'dark', 'system'] as const, 'scheme')
      return () => theme.setScheme(choice)
    },
  },
  accent: {
    about: 'the accent colour, by name',
    read: () => theme.accent,
    write: (value) => {
      const id = oneOf(
        value,
        ACCENTS.map((one) => one.id),
        'accent',
      )
      return () => theme.setAccent(id)
    },
  },
  language: {
    about: 'the language the app speaks, or system',
    read: () => i18n.choice,
    write: (value) => {
      const id = oneOf(value, ['system', ...CATALOGUE_IDS], 'language')
      return () => i18n.select(id)
    },
  },
  spellcheck: toggled(
    () => modes.spellcheck,
    () => modes.toggleSpellcheck(),
    'whether spelling is checked',
  ),
  line_numbers: toggled(
    () => modes.lineNumbers,
    () => modes.toggleLineNumbers(),
    'line numbers in code blocks',
  ),
  close_brackets: toggled(
    () => modes.closeBrackets,
    () => modes.toggleCloseBrackets(),
    'whether a bracket typed is closed',
  ),
  vim: {
    about: 'vim keys in the editor',
    read: () => modes.vim,
    write: (value) => {
      const on = isOn(value, 'vim')
      return () => modes.setVimKeys(on)
    },
  },
  width: {
    about: 'how wide a line of a note is, in characters',
    read: () => modes.width,
    write: (value) => {
      const width = numberIn(value, WIDTHS, 'width')
      return () => modes.setWidth(width)
    },
  },
  line_height: {
    about: 'the space between lines',
    read: () => modes.lineHeight,
    write: (value) => {
      const height = numberIn(value, LINE_HEIGHTS, 'line_height')
      return () => modes.setLineSpacing(height)
    },
  },
  link_format: {
    about: 'how a link to another note is written',
    read: () => modes.linkFormat,
    write: (value) => {
      const format = oneOf(value, LINK_FORMATS, 'link_format')
      return () => modes.setLinkFormat(format)
    },
  },
}

async function rows(): Promise<Field[]> {
  const { declarations } = await import('../../settings/declarations')
  return declarations()
}

async function declaredSetting(key: string, all: Field[]): Promise<Setting | null> {
  const { refusal, schemaOf } = await import('../../settings/schema')
  const named = all.filter((one) => one.key === key)
  const schema = schemaOf(named)[key]
  const [first] = named
  if (!first || !schema) return null

  const read = () =>
    schema.type === 'list'
      ? named.filter((one) => one.kind === 'switch' && one.get()).map((one) => one.member)
      : (first as { get(): unknown }).get()
  return {
    about: first.hint,
    ...(schema.enum ? { choices: schema.enum } : {}),
    read,
    write: (value) => {
      if (named.some((one) => one.kind === 'value' || one.kind === 'picture')) {
        throw new Refused('read_only', `${key} is chosen in Settings, not written`)
      }
      const why =
        refusal(schema, value) ??
        named
          .map((one) => (typeof value === 'string' ? (one.check?.(value) ?? null) : null))
          .find(Boolean) ??
        null
      if (why !== null) throw new Refused('bad_arguments', `${key} ${why}`)

      return () => {
        if (schema.type === 'list') {
          const listed = value as string[]
          const members = [...named].sort(
            (a, b) =>
              Number(listed.includes(b.member ?? '')) - Number(listed.includes(a.member ?? '')),
          )
          for (const one of members) put(one, listed.includes(one.member ?? ''))
        } else put(first, value)
      }
    },
  }
}

function put(field: Field, value: unknown): void {
  const one = field as unknown as { get(): unknown; set(value: unknown): void }
  if (one.get() !== value) one.set(value)
}

async function settingOf(call: Call): Promise<{ key: string; setting: Setting }> {
  const key = need(call, 'key')
  const setting = SETTINGS[key] ?? (await declaredSetting(key, await rows()))
  if (!setting) {
    throw new Refused(
      'no_such_setting',
      `${key} is no setting: name one as the settings file does (appearance.accent), list a pane's with its name (appearance, editor, general), or use ${Object.keys(SETTINGS).join(', ')}`,
    )
  }

  return { key, setting }
}

async function paneOf(prefix: string, call: Call): Promise<AgentAnswer | null> {
  const all = await rows()
  const keys = [
    ...new Set(all.map((one) => one.key ?? '').filter((one) => one.startsWith(`${prefix}.`))),
  ]
  if (!keys.length) return null
  const listed = []
  for (const key of keys.sort()) {
    const setting = await declaredSetting(key, all)
    if (!setting) continue
    listed.push({
      key,
      value: await setting.read(call),
      about: setting.about,
      ...(setting.choices ? { choices: setting.choices } : {}),
    })
  }
  return done({ pane: prefix, settings: listed })
}

export async function readSetting(call: Call): Promise<AgentAnswer> {
  const named = need(call, 'key')
  if (!named.includes('.') && !(named in SETTINGS)) {
    const pane = await paneOf(named, call)
    if (pane) return pane
  }
  const { key, setting } = await settingOf(call)
  return done({
    key,
    value: await setting.read(call),
    about: setting.about,
    ...(setting.choices ? { choices: setting.choices } : {}),
  })
}

export async function writeSetting(call: Call): Promise<AgentAnswer> {
  const { key, setting } = await settingOf(call)
  if (!('value' in call.args)) throw new Refused('bad_arguments', 'say the value')

  const value = call.args.value
  const was = await setting.read(call)
  if (JSON.stringify(was) === JSON.stringify(value)) return done({ key, value, changed: false })

  const change = await setting.write(value, call)
  const question = await asked(call, 'settings', `Change ${key} to ${JSON.stringify(value)}`)
  if (question) return question

  await change()
  return done({ key, value: await setting.read(call), changed: true })
}
